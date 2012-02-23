/*!
 * Connect - session - RainSessionStore
 * Mitko Tschimev
 * 
 * uses primary MemoryCache and RedisStore as backup
 */

/**
 * Module dependencies.
 */

var Store = require('connect/lib/middleware/session/store')
  , sys		= require("sys")
  , utils = require('connect/lib/utils')
  , Session = require('connect/lib/middleware/session/session');

/**
 * Initialize a new `RainSessionStore`.
 *
 * @api public
 */

var RainSessionStore = module.exports = function RainSessionStore(socketclient) {
  this.sessions = {};
  this.socketclient = socketclient || null;
};

/**
 * Inherit from `Store.prototype`.
 */

sys.inherits(RainSessionStore, Store);

/**
 * Attempt to fetch session by the given `sid`.
 *
 * @param {String} sid
 * @param {Function} fn
 * @api public
 */

RainSessionStore.prototype.get = function(sid, fn){
  var self = this;
  process.nextTick(function(){
    var expires
      , sess = self.sessions[sid];
    if (sess) {    	    	
      sess = JSON.parse(sess);
            
      expires = 'string' == typeof sess.cookie.expires
        ? new Date(sess.cookie.expires)
        : sess.cookie.expires;
      if (!expires || new Date < expires) {
        fn(null, sess);
      } else {
        self.destroy(sid, fn);
      }
    } else {
      fn();
    }
  });
};

/**
 * Commit the given `sess` object associated with the given `sid`.
 *
 * @param {String} sid
 * @param {Session} sess
 * @param {Function} fn
 * @api public
 */

RainSessionStore.prototype.set = function(sid, sess, fn){
  var self = this;
  process.nextTick(function(){
    var json_str = JSON.stringify(sess);
    self.sessions[sid] = json_str;
    if(self.socketclient)
      self.socketclient.emit('mothership/server/session/update', JSON.stringify({ sid : sid, data : sess}));
    fn && fn();
  });
};

/**
 * Destroy the session associated with the given `sid`.
 *
 * @param {String} sid
 * @api public
 */

RainSessionStore.prototype.destroy = function(sid, fn){
  var self = this;
  process.nextTick(function(){
    delete self.sessions[sid];
    if(self.socketclient)
      self.socketclient.emit('mothership/server/session/delete', sid);
    fn && fn();
  });
};

/**
 * Invoke the given callback `fn` with all active sessions.
 *
 * @param {Function} fn
 * @api public
 */

RainSessionStore.prototype.all = function(fn){
  var arr = []
    , keys = Object.keys(this.sessions);
  for (var i = 0, len = keys.length; i < len; ++i) {
    arr.push(this.sessions[keys[i]]);
  }
  fn(null, arr);
};

/**
 * Clear all sessions.
 *
 * @param {Function} fn
 * @api public
 */

RainSessionStore.prototype.clear = function(fn){
  this.sessions = {};
  fn && fn();
};

/**
 * Fetch number of sessions.
 *
 * @param {Function} fn
 * @api public
 */

RainSessionStore.prototype.length = function(fn){
  fn(null, Object.keys(this.sessions).length);
};