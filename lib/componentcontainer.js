/*
Copyright (c) 2011, Claus Augusti <claus@formatvorlage.de>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * Neither the name of the <organization> nor the
      names of its contributors may be used to endorse or promote products
      derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

"use strict";

module.exports = function (resmgr) {
if (!resmgr) { throw new Error(); }

var mod_fs                  = require('fs')
    , mod_tagmanager        = require('./tagmanager.js')
    , mod_resourcemanager   = resmgr
    , Renderer              = require('.//renderer.js')(mod_resourcemanager).Renderer
    , mod_path              = require('path')
    , mod_url               = require('url')
    , mod_querystring       = require('querystring')
    , logger                = require('./logger.js').getLogger(mod_path.basename(module.filename))
    , mod_events            = require('events')
    , mod_util              = require('util')
    , mod_sys               = require('sys');

/**  
 * Component Container, Manager, Factory, whatever. All module related thingz must belong to us. 
 *
 * Todos:
 *
 * * download component descriptors from remote web component hosts as resources. 
 * 
 */
function ComponentContainer() {
    this.componentMap = {};
    this.scanComponentFolder();

    // testing remotes
    this.registerComponent({
        "moduleId"      : "remote;1.0",
        "url"           :  "http://127.0.0.1:1338/modules/weather/htdocs/main.html"
    });
}

ComponentContainer.DEFAULT_VIEW          = 'main.html'
ComponentContainer.COMPONENT_PROTOCOL    = 'webcomponent://'
ComponentContainer.COMPONENT_METAFILE    = 'meta.json'
ComponentContainer.COMPONENT_ROOT        = mod_path.join(__dirname, '..', 'modules');

function handleViewRequest (req, res) {
    var parse         = mod_url.parse(req.url),
        query         = mod_querystring.parse(parse.query),
        outputMode    = (query['rain.output'] || 'html').toLowerCase(),
        modulename    = req.params[0],
        viewpath      = req.params[1],
        module,                       // component config object associated to request
        resource,                     // view template resource of requested view
        data          = {},
        self          = this,
        key;

    console.time('render');
    for (key in query) {
        data['req_' + key] = query[key]; 
    }


    var component = this.createComponent(parse.pathname, viewpath, outputMode, data, this, req, res);
    component.once('rendered', function (component) {
        var renderer = component.renderer;
        if (renderer.state == Renderer.STATES.RENDERED) {
            if (renderer.mode == 'html') {
                res.setHeader('Content-Type', 'text/html');
                res.end(renderer.renderresult.content);    
            } else {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(renderer.renderresult));
            }
            console.timeEnd('render');
            //Renderer.showTree(render1);
        }
    });

    /*
    if (query[RAIN_INSTANCE_PARAM]) {
        logger.debug('requiring instance per request parameter');
        if (query[RAIN_INSTANCE_PARAM] instanceof Array) {
            query[RAIN_INSTANCE_PARAM].forEach(function (iid) { addInstance(iid, resource, renderer); });
        } else {
            addInstance(query[RAIN_INSTANCE_PARAM], resource, renderer);
        }
    }
    
    function addInstance (id, resource, renderer) {
        var dataurl = 'file://' + mod_path.join(__dirname, '..', 'instances', id);
        var instanceresource = mod_resourcemanager.loadResourceByUrl(dataurl);
        instanceresource.load();
        resource.addDependency(instanceresource);
        renderer.instanceResources[id] = instanceresource;
    }
    */
}

function WebComponent(config, data) {
    this.config = config;
    this.data = data;
    
}
mod_util.inherits(WebComponent, mod_events.EventEmitter);

WebComponent.prototype.initialize = function (path, viewpath, outputMode, data, modulecontainer, req, res) {
    var self = this,
        controllerpath = mod_path.join(__dirname, '..', this.config.url, 'controller', 'js', viewpath + '.js');
    logger.debug('check for server-side view controller ' + controllerpath);
    mod_path.exists(controllerpath, function (exists, err) {
        if (exists) {
            var controller = require(controllerpath).handleRequest(req, res);
        }
        self.tagmanager = new mod_tagmanager.TagManager(self.config.taglib);
        self.renderer  =  new Renderer(self.tagmanager, modulecontainer, mod_resourcemanager, path, outputMode, null, data);

        self.renderer.once('stateChanged', function (renderer) {
            if (renderer.state == Renderer.STATES.RENDERED) {

                self.emit('rendered', self);
            }
        });
        
    });
}
 
function createComponent (path, viewpath, outputMode, data, modulecontainer, req, res) {
    var self = this,
        moduleconfig = this.resolveFromRequestPath(path),
        component = new WebComponent(moduleconfig, viewpath);
    component.initialize(path, viewpath, outputMode, data, modulecontainer, req, res);
    return component;
}

function handleControllerRequest (req, res) {
    var component = req.params[0],
        controller = req.params[1],
        method = req.method.toLowerCase(),
        mp = mod_path.join(ComponentContainer.COMPONENT_ROOT, component, 'controller', controller);

    mod_path.exists(mp, function (exists, err) {
        if (exists) {
            var module = require(mp);
            if (module[method]) {
                var handlerresponse = module[method](req, res);
            } else {
                res.writeHead(404, { 'Content-Type' : 'text/plain'} );
                res.end('HTTP method not supported');    
            }   
        } else {
            res.writeHead(404, { 'Content-Type' : 'text/plain'} );
            res.end('unknown component ' + component);
        }
    });
}

/**
 * Scans the COMPONENT_ROOT folder for component folders, reads the meta file and registers
 * the component. Called automatically upon load. 
 */
function scanComponentFolder () {
    var p, 
        self = this,
        dir = mod_fs.readdirSync(ComponentContainer.COMPONENT_ROOT);

    dir.forEach(function (file) {
        if (file.indexOf('_') == 0) { return; }     
        if (!mod_fs.statSync(mod_path.join(ComponentContainer.COMPONENT_ROOT, file)).isDirectory()) { return; }
        p = mod_path.join(ComponentContainer.COMPONENT_ROOT, file, ComponentContainer.COMPONENT_METAFILE);
        var config = JSON.parse(mod_fs.readFileSync(p).toString());
        self.registerComponent(config);
    });
}

/**
 * Returns the local HTTP path to a view resource, that is the local component path plus 
 * the view url. 
 * 
 * [TBD] this must not be mixed up with the view id introduced by Radu's code
 */
function getViewUrl (moduleConfig, view) {
    var view = view || ComponentContainer.DEFAULT_VIEW;
    if (moduleConfig.url.indexOf('http://') > -1) {
        //throw new Error('not implemented');
        return moduleConfig.url
    } else {
        return mod_path.join(moduleConfig.url, 'htdocs', view);
    }
}

/**
 * Returns the component configuration object related to the supplied component id. 
 * The module id must be of full form <component name>;<version>
 * 
 * @param {String} cid component id
 * @return {ComponentConfiguration} component configuration object
 */
function getConfiguration (cid) {
    if (!this.componentMap[cid]) { throw new Error('component ' + cid + ' not found'); }
    return this.componentMap[cid];
}

/**
 * Register a component by the supplied component configuration object. 
 *
 * @param {ComponentConfiguration} conf component configuration object
 */
function registerComponent (conf) {
    logger.debug('register component ' + conf.moduleId);
    this.componentMap[conf.moduleId] = conf;
}

/**
 * Maps from a request path to a Component configuration object, see ./conf/module.conf.default. 
 * 
 * @param {String} path request path 
 * @return {ComponentConfig}
 */
function resolveFromRequestPath (path) {
    if (path.charAt(path.length-1) != '/') path += '/'
    var match = null, item, u;
    for (var mod in this.componentMap) {
        item = this.componentMap[mod];
        u = item.path ? item.path : item.url;
        if (u.charAt(u.length-1) != '/') u += '/'
        if (path.indexOf(u) == 0) {
            match = item; 
            break;
        }
    }
    if (!match) { throw new Error('module config for ' + path + ' not found'); }
    return match;
}

/**
 * Resolves a webcomponent:// protocol uri to a host-local or remote HTTP URL.
 * 
 * @param {String} module module id (<name>;<version>)
 * @param {String} url uri to resolve
 * @param {String} resoled URL
 */
function resolveUrl (module, url) {
    var cpl = ComponentContainer.COMPONENT_PROTOCOL.length,
        moduleid = url.substring(cpl, url.indexOf('/', cpl + 1)),
        path = url.substring(cpl + moduleid.length),
        conf = this.getConfiguration(moduleid);
    if (conf.url.indexOf('http') > -1) {
        return conf.url + path;
    } else {
        return mod_path.join(conf.url, path);
    }
}

function getViewConfigItem (url, moduleconfig) {
    if (moduleconfig && moduleconfig.views) {
        for (var i = 0; i < moduleconfig.views.length; i++) {
            var c = mod_path.join(moduleconfig.url, moduleconfig.views[i].view);
            if (url.indexOf(c) == url.length - c.length) {
                return moduleconfig.views[i];
            } 
        }
    }
    return null;
}

ComponentContainer.prototype.handleViewRequest         = handleViewRequest;
ComponentContainer.prototype.handleControllerRequest   = handleControllerRequest;
ComponentContainer.prototype.scanComponentFolder       = scanComponentFolder;
ComponentContainer.prototype.getViewUrl                = getViewUrl;
ComponentContainer.prototype.getConfiguration          = getConfiguration;
ComponentContainer.prototype.registerComponent         = registerComponent;
ComponentContainer.prototype.resolveFromRequestPath    = resolveFromRequestPath;
ComponentContainer.prototype.resolveUrl                = resolveUrl;
ComponentContainer.prototype.getViewConfigItem         = getViewConfigItem;
ComponentContainer.prototype.createComponent           = createComponent;

return {ComponentContainer : ComponentContainer};

}