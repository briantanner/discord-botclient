const _ = require('underscore');
const ipcRenderer = require('electron').ipcRenderer;

let main = angular.module('mainApp', ['ngSanitize', 'scrollglue']);

main.controller('MainController', ['$scope', MainController]);
main.controller('TokenController', ['$scope', TokenController]);

function MainController($scope) {
  $scope.title = "Grepolis Discord";
  $scope.servers = {};
  $scope.message = "";
  $scope.messages = {};
  $scope.activeServer = null;
  $scope.activeChannel = null;
  $scope.activateServer = activateServer;
  $scope.activateChannel = activateChannel;
  $scope.sendMessage = sendMessage;
  $scope.keyup = keyup;
  $scope.typing = false;
  
  function keyup($event) {
    let ignored = [9,16,17,18,19,20,20,27,33,34,35,36,37,38,39,40,45,46,91,92,93];
    
    if (ignored.indexOf($event.keyCode) !== -1) {
      return;
    }
    
    if ($scope.message === null || $scope.message.length === 0) {
      typing('stop');
      return;
    }
    
    if ($event.keyCode === 13) {
      typing('stop');
      sendMessage();
      return;
    }
    
    if (!$scope.typing) {
      $scope.typing = true;
      typing('start');
      setTimeout(function() {
        typing('stop');
      }, 1000);
    }
  }
  
  function addMessage(event, message) {
    if (!$scope.messages[message.channel]) {
      $scope.messages[message.channel] = [];
    }
    
    if (_.isArray(message)) {
      let sample = _.sample(message),
          messages = $scope.messages[sample.channel] || [];
      
      message = message.map(msg => {
        msg.cleanContent = msg.cleanContent.replace(/(?:\r\n|\r|\n)/g, '<br />');
        msg.author.color = msg.author.roles && msg.author.roles[0] ? 
          msg.author.roles[0].color : '#efefef';

        return msg;
      });
      
      messages = message.concat(messages);
      
      $scope.messages[sample.channel] = messages;
      $scope.$apply();
      
      return;
    }
    
    message.author.color = message.author.roles && message.author.roles[0] ? 
          message.author.roles[0].color : '#efefef';
    
    $scope.messages[message.channel].push(message);
    
    if ($scope.messages[message.channel].length > 100) {
      $scope.messages[message.channel] = $scope.messages[message.channel].slice(-100);
    }
    
    $scope.$apply();
  }
  
  function sendMessage() {
    ipcRenderer.send($scope.activeChannel.id, {
      type: 'message',
      message: $scope.message
    });
    
    $scope.message = "";
  }
  
  function typing(action) {
    $scope.typing = (action === 'start') ? true : false;
    
    ipcRenderer.send($scope.activeChannel.id, {
      type: 'typing',
      action: action,
      channel: $scope.activeChannel
    });
  }
  
  function activateServer(serverId) {
    server = $scope.servers[serverId];
    $scope.activeServer = server;
    // $scope.$apply();
  }
  
  function deactivateServer() {
    $scope.activeServer = null;
    // $scope.$apply();
  }
  
  function activateChannel(channel) {
    ipcRenderer.send('activateChannel', channel);
    
    $scope.message = "";
    $scope.activeChannel = channel;
  }
  
  ipcRenderer.on('server-create', function (event, server) {
    $scope.servers[server.id] = server;

    // sort channels by position
    server.channels = _.sortBy(server.channels, ch => ch.position);

    for (let channel of server.channels) {
      ipcRenderer.on(channel.id, addMessage);
    }
    
    $scope.$apply();
  });
  
  ipcRenderer.on('server-update', function (event, server) {
     $scope.servers[server.id] = server;
     $scope.$apply();
  });
  
  ipcRenderer.on('server-delete', function (event, server) {
    delete $scope.servers[server.id];
    $scope.$apply();
  });
}

function TokenController($scope) {
  $scope.token = "";
  $scope.saveToken = saveToken;
  
  function saveToken() {
    ipcRenderer.send('token', $scope.token);
  }
}