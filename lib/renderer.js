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

exports.Renderer = Renderer;

var   parseHtmlView       = require('./parser.js').parseHtmlView
    , WebComponent        = require('./componentcontainer').WebComponent
    , ComponentContainer  = require('./componentcontainer').ComponentContainer
    , Resource            = require('./resources.js').Resource
    , TranslationManager  = require('./translationmanager')
    , mod_path            = require('path')
    , mod_mu              = require('mu')
    , mod_crypto          = require('crypto')
    , HTMLRenderer        = require('./htmlrenderer.js').HTMLRenderer
    , logger              = require('./logger.js').getLogger(mod_path.basename(module.filename), 0)
    , rendererCount       = 0
    , c                   = console.log;

/**
 * 
 * @param obj : component, url, mode, element, data, tagfactory, req, res
 */
function Renderer(obj) {
    obj = obj || {};
    if (!obj.component instanceof WebComponent || !obj.url) { throw new Error('missing arguments'); }
    this.component      = obj.component;
    this.url            = obj.url;
    this.resource       = this.component.resourcemanager.getResourceByUrl(obj.url);        
    this.resource.load();
    this.translationmanager = new TranslationManager(this.component.config, obj.data['req_rain.lang']);
    this.mode           = obj.mode || Renderer.MODES.HTML;
    this.data           = obj.data;
    this.tagfactory		= obj.tagfactory;
    this.state          = Renderer.STATES.INIT;
    this.uuid           = ++rendererCount;
    this.element        = obj.element;                                      // reference to the element context object created by the parser
    this.parentcontent  = obj.element ? obj.element.elementContent : null;      // contains the original child content of the tag this component resolved to
    this.parseresult    = null;
    this.renderresult   = null;
    this.parentrenderer = null;
    this.rendererLevel  = '';
    this.instanceIdMap  = {};
    this.childrenderers = [];
    this.req            = obj.req;
    this.res            = obj.res;
    var self            = this;
    this.resource.addListener('stateChanged', function (resource) {
        if (resource.state >= Resource.STATES.COMPLETE) {
            if (self.state < Renderer.STATES.PARSED) { 
                self.parse(); 
            }
        }
    });
}
require('util').inherits(Renderer, require('events').EventEmitter);

Object.defineProperty(Renderer.prototype, 'state', {
    get : function () {
        return this._state;
    },  
    set : function (val) {
        if ('number' !== typeof val) { throw Error('expected number ' + val); }
        this._state = val;
        this.emit('stateChanged', this);
    }
});

Renderer.STATES = {
    INIT            : 0,
    PARSED          : 20,
    CHILDSPARSED    : 30,
    RENDERED        : 40
};

Renderer.prototype.parse = function () {
    var self = this,
        resourcecontent = null;
    logger.debug(this.uuid + ': parse');

    var currenttagmanager = null;
    if (this.parentcontent) {
        resourcecontent = this.resource.data.toString().replace(new RegExp('<c:content/>'), this.parentcontent);
        logger.debug('include parent content '/* + resourcecontent*/);  
        this.tagmanager = this.parentrenderer.tagmanager;  
        currenttagmanager = this.parentrenderer.component.tagmanager;
    } else {
    	if(this.resource.data != null) {
    		resourcecontent = this.resource.data.toString();
    	}
        currenttagmanager = this.component.tagmanager;
    }
    
    parseHtmlView(resourcecontent, this.resource.url, currenttagmanager/*this.tagmanager*/, this.tagfactory)
            .then(function (parseresult) {

        if (!self.parentrenderer) {
            parseresult.document = parseresult.document.replace(/<body([^>]*)>([\s\S]*)<\/body>/,
                    function (matchstring, bodyAttributes, content) {
                var element = { renderer: self };
                return "<body" + bodyAttributes + ">"
                       + self._createElementOpen(element) + content
                       + self._createElementClose(element)
                       + "</body>";
            });
        }

        self.parseresult = parseresult;
        if (parseresult.elements.length == 0) {
            self.parseresult = parseresult;
            self.render();
        } else {
            //extend rendererLevel with component name and version if it is a child
            var rendererLevel = self.parentrenderer ? self.parentrenderer.rendererLevel : self.rendererLevel,
                config = self.component.config,
                attrs = self.element ? self.element.sourceElement.attrs : [],
                staticId;
            rendererLevel += '/' + config.id+config.version;
            for (var i = attrs.length; i--;) {
                if (attrs[i][0] == 'data-sid'){
                    staticId = attrs[i][1];
                    break;
                }
            }

            // Make sure the parent has the instanceIdMap generated
            // so the children can know their parent renderer's domId
            self.getInstanceIdMap(staticId);
            rendererLevel += staticId;
            self.rendererLevel = rendererLevel;

            parseresult.elements.forEach(function (child) {
                var component = self.component.componentcontainer.createComponent(child.tag.module);
                component.initialize(child.tag.view, 'json', { "req_rain.lang" : self.data['req_rain.lang']}, self.req, self.res, child, self.tagfactory);
                var childrenderer = component.renderer;
                child.renderer = childrenderer;
                self.addChildRenderer(childrenderer);
            });
        }
        this.state = Renderer.STATES.PARSED;
    });
};

Renderer.prototype.addChildRenderer = function (renderer) {
    if (!renderer) { throw new Error('wrong type'); } 
    var self = this;
    logger.debug(this.uuid + ': addChildRenderer ' + renderer.uuid + ', resurl ' + renderer.resource.url);

    renderer.addListener('stateChanged', function (renderer) {
        logger.debug(self.uuid + ': renderer ' + renderer.uuid + ' changed state to ' + renderer.state);
        var rendered = self.childrenderers.every(function (renderer) {
            return renderer.state >= Renderer.STATES.RENDERED;
        });
        if (rendered) {
            logger.debug(self.uuid + ' all rendered');
            self.render();
        }
    });

    this.childrenderers.push(renderer);
    renderer.parentrenderer = this;
};

Renderer.prototype.render = function () {
    var self = this;
    logger.debug(this.uuid + ': render');
    this.renderTemplate(function (document) {
        self.renderView(document);
        self.state = Renderer.STATES.RENDERED;
    });
};

Renderer.prototype.renderTemplate = function (callback) {
    var document = this.parentrenderer == null ? this.parseresult.document : HTMLRenderer.getViewBody(this.parseresult.document),
        self = this,
        data = this.data || {},
        element;

    for (var i = 0, l = this.parseresult.elements.length; i < l; i++) {
        element = this.parseresult.elements[i];

        data['__rainmarker_element_open_' + element.id] = self._createElementOpen(element);
        data['__rainmarker_element_close_' + element.id] = self._createElementClose(element);
        data['__rainmarker_element_content_' + element.id] = element.renderer.renderresult.content;
    }

    // this sucks, because mustache sucks even more
    if (this.element) {
        this.element.sourceElement.attrs.forEach(function (keyvalue) {
            data['attr_' + keyvalue[0]] = keyvalue[1];
        });
    }

    var templating = function(template){
      var buffer = "";
      mod_mu.compileText('viewtemplate', template);
      var stream = mod_mu.render('viewtemplate', data)
        .on('data', function (c) {
          buffer += c;
        })
        .on('end' , function () {
            logger.debug(self.uuid + ': done templating');
            callback(buffer);
        });
    };
    
    var transmgr = this.translationmanager;
    switch(transmgr.__state){
      case transmgr.STATES.NO_LOCALES:
        templating(document);
        break;
      case transmgr.STATES.LOADED:
        this.translationRenderer(document, templating);
        break;
      default:
        transmgr.addListener('stateChanged', function (event) { 
          if(transmgr.__state == transmgr.STATES.LOADED){
            self.translationRenderer(document, templating);
          } else {
            templating(document);
          }
        });
        break;
    };
};

/**
 * Creates the DOM fragment to be included before an element's content.
 * Includes the DIV wrapper and a SCRIPT for controller initialization.
 * 
 * @param element The element to decorate
 * @returns {String} fragment The generated fragment
 */
Renderer.prototype._createElementOpen = function (element) {
    var viewConfig,
        clientControllerPath,
        instanceIdMap,
        component = element.renderer.component,
        parentRenderer = element.renderer.parentrenderer,
        ComponentContainer = component.componentcontainer,
        fragment,
        attrs = [],
        attrName,
        attrValue,
        attrsStr,
        staticId = 0,
        reNormalize = /[:;\.]/g,
        moduleName,
        viewId;

    /*
        Add normalized module name class for css scoping.
        If the element is a subcomponent, it has a tag object from the parser.
        Otherwise, extract the module name from the component's config.
    */
    if (element.tag) {
        moduleName = element.tag.module.replace(reNormalize, '_');
    } else {
        moduleName = component.config.id + "_"
                     + component.config.version.replace(reNormalize, '_');
    }
    attrs.push('class="app_container ' + moduleName + '"');

    if (element.id) {
        attrs.push('data-viewid="' + element.id + '"');
    }

    /*
        Push element attributes from the parser and locate the data-sid static id
        for generating the instanceId-domId map.
    */
    if (element.sourceElement) {
        for (var i = element.sourceElement.attrs.length; i--;) {
            attrName = element.sourceElement.attrs[i][0];
            attrValue = element.sourceElement.attrs[i][1];

            if (attrName !== 'data-sid') {
                attrs.push(attrName + '="' + attrValue + '"');
            } else {
                staticId = attrValue;
            }
        }
    }

    instanceIdMap = element.renderer.getInstanceIdMap(staticId);
    attrs.push('data-instanceid="' + instanceIdMap.domId + '"');

    // Assemble all normal and generated attributes
    var attrsStr = attrs.length ? attrs.join(' ') : '';

    // Start building the fragment
    fragment = [
        '<div ' + attrsStr + '>',        // Begin component div
        '<script type="application/javascript">',
        'require(["core-components/raintime/raintime"], function (Raintime) {',
        'var Registry = Raintime.ComponentRegistry, Controller = Raintime.ComponentController, component;',
        'var domId = ' + instanceIdMap.domId + ';',
        'var parentDomId = ' + (parentRenderer ? parentRenderer.instanceIdMap.domId : 'null') + ';'
    ];

    viewConfig = ComponentContainer.getViewConfigItem(element.renderer.url, element.renderer.component.config);
    if (!viewConfig || !viewConfig.controller) {
        logger.debug("No client-side controller found for " + element.id);
        return '<div ' + attrStr + '>';
    }

    clientControllerPath = mod_path.join(element.renderer.component.config.url, viewConfig.controller);

    fragment.push('component = Registry.register({',
                  '"domId": domId,',
                  '"instanceId": "' + instanceIdMap.instanceId + '",',
                  '"clientcontroller": "' + clientControllerPath + '"});');

    if (parentRenderer) {
        fragment.push('component.addParent(parentDomId);');
    }

    fragment.push('Controller.preRender(domId);',
                  '});',                               // Close define
                  '</script>');

    // Assemble the fragment and return it
    return fragment.join("\n");
}

/**
 * Creates the DOM fragment to be appended after an element's content.
 * Consists of a SCRIPT calling postRender.
 * 
 * @param element The element to decorate
 * @returns {String} fragment The generated fragment
 */
Renderer.prototype._createElementClose = function (element) {
    var domId = element.renderer.instanceIdMap.domId,
        fragment = [
            '<script type="application/javascript">',
                'require(["core-components/raintime/raintime"],',
                'function (Raintime) {',
                    'var Controller = Raintime.ComponentController;',
                    'var domId = ' + domId + ';',
                    'Controller.postRender(domId);',
                '});',
            '</script>',
            '</div>'       // End component div
        ];

    return fragment.join("\n");
}

Renderer.prototype.translationRenderer = function(template, callback){
  var self = this,
      transmgr = this.translationmanager;
  
  logger.debug('translationRenderer ' + self.uuid);
  this.translationmanager.parseTemplateAsXML(template, callback);
};

Renderer.prototype.renderView = function (document) {
    logger.debug(this.uuid + ': renderView');
    var self = this,
        deps = this.collectChildDependencies(),
        viewConfig,
        clientController;

    viewConfig = this.component.componentcontainer.getViewConfigItem(this.url,
        this.component.config);
    if (viewConfig && viewConfig.controller) {
        clientController = mod_path.join(this.component.config.url, viewConfig.controller);
    }

    this.renderresult = {
        dependencies : {
            css     : deps.css.concat(this.parseresult.dependencies.css.map(function (url) { return self.resolveUrl(url); })),
            script  : deps.script.concat(this.parseresult.dependencies.script.map(function (url) { return self.resolveUrl(url); })),
            locale  : deps.locale.concat(this.parseresult.dependencies.locale.map(function (url) { return self.resolveUrl(url); }))
        }, 
        clientcontroller : this.resolveUrl(clientController || this.parseresult.clientcontroller),
        content : document
    };

    if (this.parentrenderer == null) {
        logger.debug('root renderer');
        this.renderresult.dependencies.css      = Renderer.unique(this.renderresult.dependencies.css);
        this.renderresult.dependencies.script   = Renderer.unique(this.renderresult.dependencies.script);
        this.renderresult.dependencies.locale   = Renderer.unique(this.renderresult.dependencies.locale); 
        if (this.mode == 'html') {
            this.renderresult.content = HTMLRenderer.renderDocument(this, this.component.componentcontainer);    
        }
    }
};

Renderer.prototype.collectChildDependencies = function () {
    var self = this;
    var css = [],
        script = [],
        locale = [];

    this.childrenderers.forEach(function (renderer) {
        var deps = renderer.getDependencies();
        css      = deps.css.concat(css);
        script   = deps.script.concat(script);
        locale   = deps.locale.concat(locale);
    });

    return {
        css : css,
        script : script,
        locale : locale
    };
};

Renderer.prototype.getDependencies = function (isRemote) {
    // [TBD] isRemote
    var self = this, m = function (url) { return self.resolveUrl(url); };
    return {
        css     : this.renderresult.dependencies.css.map(m),
        script  : this.renderresult.dependencies.script.map(m),
        locale  : this.renderresult.dependencies.locale.map(m)
    };
};

Renderer.prototype.resolveUrl = function (url, isRemote) {
    if (!url) return;
    // [TBD] WORKAROUND, resolveUrl must only be called once for a URL
    if (url.indexOf('/component') == 0) {
        return url;
    }
    if (url.indexOf(ComponentContainer.COMPONENT_PROTOCOL) == 0) {
        return this.component.componentcontainer.resolveUrl(this.component.config, url);
    }
    if (url.indexOf('http') == -1) {
        return mod_path.join(this.component.config.url, url);
    }
};

/**
 * 
 * @param static_id - static id of the component to create a unique instance id
 * @returns instanceId
 */

Renderer.prototype.getInstanceIdMap = function(static_id){
    if(this.instanceIdMap.domId && this.instanceIdMap.instanceId)
        return this.instanceIdMap;
    
    //set instanceId for component
    if(!this.req.domInstanceId){
        //create property if it is the first initializing
        this.req.domInstanceId = 0;
    }
        
    var instanceIds = this.req.session.instanceIds
       ,instanceId = null
       ,pInstanceId = this.parentrenderer ? this.parentrenderer.instanceIdMap.instanceId : ''
       ,component_id = this.component.config.id+this.component.config.version+'_pInstanceId='+pInstanceId+(static_id?'_staticID='+static_id:'')
       ,domId = ++this.req.domInstanceId;
    
    if(!instanceIds){
        instanceIds = this.req.session.instanceIds = {};
    }

    if(instanceIds[component_id]){
        instanceId = instanceIds[component_id];
    } else {
        this.req.session.instanceIds[component_id] = instanceId = mod_crypto.createHash('sha1').update(this.req.sessionID+Server.UUID+(new Date()).getTime()+static_id+pInstanceId).digest('hex');
    }
    
    return this.instanceIdMap = {
        domId : domId,
        instanceId : instanceId
    };
};

Renderer.MODES = {
    HTML    : 1,
    JSON    : 2
};

Renderer.unique = function (array) {
    var hlp = {},
        arr = [];
    array.forEach(function (item) {
        if (!hlp[item]) {
            arr.push(item);
            hlp[item] = true;
        }
    });
    return arr;
};

Renderer.showTree = function (renderer) {
    var spaces = '                                                       ';
    show(renderer, 0);

    function show(renderer, depth) {
        logger.debug(spaces.substring(0, depth*2) + ' ' + renderer.uuid + '; view template ' + renderer.resource.url);
        for (var i = 0; i < renderer.childrenderers.length; i++) {
            show(renderer.childrenderers[i], depth + 1);
        }
    }
	};
