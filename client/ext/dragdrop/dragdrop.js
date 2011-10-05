/**
 * Native drag 'n drop upload for Cloud9 IDE
 *
 * @copyright 2010, Ajax.org B.V.
 */

define(function(require, exports, module) {

var ide    = require("core/ide");
var ext    = require("core/ext");
var util   = require("core/util");
var fs     = require("ext/filesystem/filesystem");
var tree   = require("ext/tree/tree");
var markup = require("text!ext/dragdrop/dragdrop.xml");

var MAX_UPLOAD_SIZE = 52428800;
var MAX_OPENFILE_SIZE = 2097152;
var MAX_CONCURRENT_FILES = 10;

module.exports = ext.register("ext/dragdrop/dragdrop", {
    dev         : "Ajax.org",
    name        : "Dragdrop",
    alone       : true,
    type        : ext.GENERAL,
    deps        : [tree],
    
    nodes: [],
    
    files: [],
    queue: [],
            
    init: function() {
        //if (!apf.hasDragAndDrop)
        //    return;
        
        trFiles.parentNode.insertMarkup(markup);
        this.nodes.push(trFiles.$ext, tabEditors.$ext);
        
        var dropbox = document.createElement("div");
        apf.setStyleClass(dropbox, "draganddrop");
        
        var label = document.createElement("span");
        label.textContent = "Drop files here to upload";
        dropbox.appendChild(label);
        
        this.nodes.forEach(function(holder) {
            dropbox = holder.dropbox = dropbox.cloneNode(true);
            holder.appendChild(dropbox);
            
            holder.addEventListener("dragenter", dragEnter, false);
            dropbox.addEventListener("dragleave", dragLeave, false);
            dropbox.addEventListener("drop", dragDrop, false);
            
            ["dragexit", "dragover"].forEach(function(e) {
                dropbox.addEventListener(e, noopHandler, false);
            });
        });
        
        var _self  = this;
        
        this.dragStateEvent = {"dragenter": dragEnter};
        
        function dragLeave(e) {
            apf.stopEvent(e);
            apf.setStyleClass(this, null, ["over"]);
        }
        
        function dragEnter(e) {
            apf.stopEvent(e);
            apf.setStyleClass(this.dropbox, "over");
        }
        
        function dragDrop(e) {
            dragLeave.call(this, e);
            return _self.onBeforeDrop(e);
        }
        
        function noopHandler(e) {
            apf.stopEvent(e);
        }
        
        this.StatusBar = {
            begin: function(files) {
                this.reset();
                apf.addEventListener("http.uploadprogress", _self.onProgress);
                if (!dlStatus.visible)
                    dlStatus.show();
                
                this.fileCount = files.length;
            },
            end: function() {
                this.reset();
                dlStatus.hide();
                dlStatusInfo.removeAttribute("caption");
                dlStatusFile.removeAttribute("caption");
            },
            update: function(fileName, i) {
                var caption = "Uploading file " + i +  " of " + this.fileCount;
                dlStatusInfo.setAttribute("caption", caption);
                dlStatusFile.setAttribute("caption", fileName);
            },
            reset: function() {
                apf.removeEventListener("http.uploadprogress", _self.onProgress);
                dlProgressbar.setValue(0);
                this.fileCount = 0;
            },
            grow: function(percent) {
                dlProgressbar.setValue(percent.toFixed());
            }
        };
        
        this.onProgress = this.onProgress.bind(this);
    },
    
    onBeforeDrop: function(e) {
        // @see Please, go to line 176 for clarification.
        if (!(window.File && window.FileReader/* && window.FormData*/)) {
            util.alert(
                "Could not upload file(s)", "An error occurred while dropping this file(s)",
                "Your browser does not offer support for drag and drop for file uploads. " +
                "Please try with a recent version of Chrome or Firefox browsers."
            );
            return false;
        }
        // Check the number of dropped files exceeds the limit
        if (e.dataTransfer.files.length > MAX_CONCURRENT_FILES) {
            util.alert(
                "Could not upload file(s)", "An error occurred while dropping this file(s)",
                "You can only drop " + MAX_CONCURRENT_FILES + " files to upload at the same time. " + 
                "Please try again with " + MAX_CONCURRENT_FILES + " or a lesser number of files."
            );
            return false;
        }
        // Check total filesize of dropped files
        for (var size = 0, i = 0, l = e.dataTransfer.files.length; i < l; ++i)
            size += e.dataTransfer.files[i].fileSize;

        if (size > MAX_UPLOAD_SIZE) {
            util.alert(
                "Could not save document", "An error occurred while saving this document",
                "The file(s) you dropped exceeds the maximum of 50MB and could therefore not be uploaded."
            );
            return false;
        }
        
        if (e.dataTransfer.files.length < 1)
            return false;
        
        this.onDrop(e);
        
        return true;
    },
    
    onDrop: function(e) {
        var _self = this;
        var dt = e.dataTransfer;
        
        function async(files) {
            _self.StatusBar.begin(files);
            
            apf.asyncForEach(files, function(file, next, i) {
                // If any JS exception coming from webdav would happen...
                if (!file || !next)
                    return end();
                
                // Quick values giving user some feedback before fs.exists()
                // figures out which available file name *.N to use...
                dlProgressbar.setValue(0);
                _self.StatusBar.update(file.name, i + 1);
                    
                // Chrome, Firefox
                if (apf.hasFileApi) {
                    // Processing ...
                    var reader = new FileReader();
                    // Init the reader event handlers
                    reader.onloadend = _self.onLoad.bind(_self, file, next, i);
                    // Begin the read operation
                    reader.readAsBinaryString(file);
                }
                else {
                    // Safari >= 5.0.2 and Safari < 6.0
                    _self.onLoad(file, next, _self.getFormData(file));
                    /**
                     * @fixme Safari for Mac is buggy when sending a XHR using a
                     * FormData instance. There's a know problem in their source
                     * causing often the injection of `WebKitFormBoundary` in the
                     * request body, making it imposible to construct any multipart
                     * message manually and to construct headers.
                     * 
                     * @see http://www.google.es/url?sa=t&source=web&cd=2&ved=0CCgQFjAB&url=https%3A%2F%2Fdiscussions.apple.com%2Fthread%2F2412523%3Fstart%3D0%26tstart%3D0&ei=GFWITr2BM4SEOt7doNUB&usg=AFQjCNF6WSGeTkrpaqioUyEswi9K2xhZ8g
                     * @note In safari 6.0, seems like FileReader will be finally impl.
                     */
                }
            }, end);
        }
        
        function end() {
            _self.StatusBar.end();
            
            if (_self.queue.length) {
                var files = _self.files = _self.queue;
                _self.queue = [];
                async(files);
            }
            else {
                _self.files = [];
            }
        }
        
        var i = 0;
        if (!this.files.length) {
            for (; i < dt.files.length; i++)
                this.files.push(dt.files.item(i));
            
            async(this.files);
        }
        else {
            for (; i < dt.files.length; i++)
                this.queue.push(dt.files.item(i));
        }
    },
    
    onLoad: function(file, next, i, e) {
        var node = trFiles.selected;
        if (!node)
            node = trFiles.xmlRoot.selectSingleNode("folder");
        else if (node.getAttribute("type") !== "folder")
            node = node.parentNode;
            
        var path     = node.getAttribute("path");
        var filename = file.name;
        var index    = 0;
        var _self    = this;

        function check(exists) {
            if (exists) {
                filename = file.name + "." + index++;
                fs.exists(path + "/" + filename, check);
            } else
                upload();
        }
        
        function upload() {
            _self.StatusBar.update(filename, i + 1);
            var data = e instanceof FormData ? e : e.target.result;
            var oBinary = {
                filename: file.name,
                filesize: file.fileSize,
                blob: file
            };
            /*if (data instanceof FormData) {
                oBinary.filedataname = file.name;
                oBinary.multipart = true;
            }*/
            fs.webdav.write(path + "/" + filename, data, false, oBinary, complete);
        }
        
        function complete(data, state, extra) {
            if (state != apf.SUCCESS) {
                return util.alert(
                    "Could not save document",
                    "An error occurred while saving this document",
                    "Please see if your internet connection is available and try again. "
                        + (state == apf.TIMEOUT ?
                            "The connection timed out." :
                            "The error reported was " + extra.message),
                    next);
            }
            
            // Request was successful
            fs.webdav.exec("readdir", [path], function(data) {
                if (data instanceof Error) {
                    // @todo: in case of error, show nice alert dialog.
                    return next();
                }
                
                var child = apf.queryNode(node, 'file[starts-with(@path, "' + path + "/" + filename + '")]');
                if (!child) {
                    var filePath = "(<file path='" + path + "/" + filename + "'.*?>)";
                    var strXml = data.match(new RegExp((filePath).replace(/\//g, "\\/")))[1];
                    if (strXml)
                        child = apf.xmldb.appendChild(node, apf.getXml(strXml));
                }
                if (child) {
                    trFiles.select(child);
                    if (file.fileSize < MAX_OPENFILE_SIZE)
                        ide.dispatchEvent("openfile", {doc: ide.createDocument(child)});
                }
                
                next();
            });
        }
        
        // First check if path already exists, otherwise continue to upload()
        fs.exists(path + "/" + file.name, check);
    },
    
    onProgress: function(o) {
        var e = o.extra;
        var loaded = e.loaded;
        var total = e.total;
        this.StatusBar.grow((loaded / total) * 100);
    },
    
    getFormData: function(file) {
        var form = new FormData();
        form.append("upload", file);
        
        return form;
    },
    
    enable: function() {
        var _self = this;
        this.nodes.each(function(item) {
            for (var e in _self.dragStateEvent)
                item.addEventListener(e, _self.dragStateEvent[e], false);
        });
        dlStatus.enable();
    },
    
    disable: function() {
        var _self = this;
        this.nodes.each(function(item) {
            for (var e in _self.dragStateEvent)
                item.removeEventListener(e, _self.dragStateEvent[e]);
        });
        dlStatus.disable();
        //apf.removeEventListener("http.uploadprogress", this.onProgress);
    },
    
    destroy: function() {
        var _self = this;
        this.nodes.each(function(item){
            item.removeChild(item.dropbox);
            for (var e in _self.dragStateEvent)
                item.removeEventListener(e, _self.dragStateEvent[e]);
        });
        this.nodes = [];
        dlStatus.destroy();
        //apf.removeEventListener("http.uploadprogress", this.onProgress);
    }
});

});