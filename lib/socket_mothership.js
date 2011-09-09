var io         = require('socket.io-client/lib/socket.io-client')
    , mod_path = require('path')
    , logger   = require('./logger.js').getLogger(mod_path.basename(module.filename));

exports.init = function(){

  var client = new io.connect(Server.conf.mothership.host, {
    port: Server.conf.mothership.port
  });
  
  client.on('connect', function(){
    logger.info("Connected to mothership!");
  })

  client.on('disconnect', function(){
    logger.info("Disconnected from mothership!");
  });
  
  client.on('server.registered', function(server_uuid){
    global.Server.UUID = server_uuid;
    client.emit('server.registered.successful', Server.address);
  });
  
  client.on('ms.server_disconnected', function(server_uuid){
    logger.info('TODO: update server/app relation');
  });  
};
