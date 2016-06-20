"use strict";

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const electron = require('electron');
const ipcMain = require('electron').ipcMain;
const moment = require('moment');
const _ = require('underscore');
const Datastore = require('nedb');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const Menu = require('electron').Menu;
const appMenu = require('./appMenu')(app);
const dataFile = path.join(app.getPath('userData'), 'data.json');
const salt = 'eBRk2BYI8aOXwrxR3FnLi8Ruv8XScXmo' + app.getPath('userData');

let main;

class Main {
  
  constructor(bot) {
    this.mainWindow = null;
    this.bot = bot;
    this.activeChannel = null;
    
    console.log(app.getPath('userData'));
    this.config = new Datastore({
      filename: path.join(app.getPath('userData'), 'config.db'),
      autoload: true
    });
    
    // App event handlers
    app.on('ready', this.login.bind(this));
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('activate', () => {
      if (this.mainWindow === null) {
        this.createWindow();
      }
    });
    
    // Bot event handlers
    bot.on('ready', this.onReady.bind(this));
    bot.on('disconnected', this.login.bind(this));
    bot.on('message', this.onMessage.bind(this));
    bot.on('serverCreated', this.createServer.bind(this));
    bot.on('serverDeleted', this.deleteServer.bind(this));
    bot.on('channelCreated', this.createChannel.bind(this));
    bot.on('channelDeleted', this.deleteChannel.bind(this));
    
    // Renderer event handlers
    ipcMain.on('activateChannel', this.activateChannel.bind(this));
  }
  
  get app() {
    return app;
  }
  
  login() {
    this.config.findOne({}, (err, doc) => {
      if (!doc || !doc.token) {
        return this.createTokenWindow();
      }
      
      this.token = doc.token;
      
      this.bot.loginWithToken(this.token)
        .then(this.createWindow.bind(this))
        .catch(err => {
          console.log(err);
        });
    });
  }
  
  saveToken(event, token) {
    this.config.update({}, {token: token}, {upsert: true}, (err, n) => {
      this.login();
      this.tokenWindow.close();
    });
  }
  
  createTokenWindow() {
    this.tokenWindow = new BrowserWindow({width: 650, height: 100});
    this.tokenWindow.loadURL('file://' + __dirname + '/token.html');
    Menu.setApplicationMenu(Menu.buildFromTemplate(appMenu));
    
    ipcMain.on('token', this.saveToken.bind(this));
  }
  
  createWindow() {
    this.mainWindow = new BrowserWindow({width: 1280, height: 720});
    this.mainWindow.loadURL('file://' + __dirname + '/index.html');

    // Open the DevTools.
    // this.mainWindow.webContents.openDevTools();

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });
    
    Menu.setApplicationMenu(Menu.buildFromTemplate(appMenu));
    
    app.mainWindow = this.mainWindow;
  }
  
  onReady() {
    // load servers
    this.bot.servers.forEach(server => {
      this.createServer(server);
    });
  }
  
  createServer(server) {
    let _server = _.clone(server),
        _channels = {};
    
    server.channels.forEach(channel => {
      if (channel.type !== 'text') {
        return;
      }
      
      _channels[channel.id] = _.clone(channel);
      
      ipcMain.on(channel.id, this.sendCommand.bind(this, _channels[channel.id]));
    });
    
    _server.channels = _channels;
    
    this.mainWindow.webContents.send('server-create', _server);
  }
  
  deleteServer(server) {
    this.mainWindow.webContents.send('server-delete', server);
  }
  
  createChannel(channel) {
    this.mainWindow.webContents.send('server-update', channel.server);
    ipcMain.on(channel.id, this.sendCommand.bind(this, _channels[channel.id]));
  }
  
  deleteChannel(channel) {
    this.mainWindow.webContents.send('server-update', channel.server);
  }
  
  formatMessage(message) {
    let msg = _.clone(message);
    
    // don't need this reference
    delete msg.client;
    
    msg.timestamp = moment.unix(msg.timestamp / 1000).format('hh:mm:ss a');
    
    msg.author.roles = msg.channel.server.rolesOfUser(msg.author);
    msg.author.roles = msg.author.roles.map(role => {
      role = _.clone(role);
      role.color = role.colorAsHex() === '#000000' ? '#fefefe' : role.colorAsHex();
      return role;
    });
    
    msg.channel = msg.channel.id;
    msg.author = _.pick(msg.author, ['id', 'username', 'discriminator', 'avatar', 'roles' ]);
    
    return msg;
  }
  
  activateChannel(event, channel) {
    this.activeChannel = channel;
    this.bot.getChannelLogs(channel.id, 50)
      .then(messages => {
        let _messages = messages.map(this.formatMessage);
        event.sender.send(channel.id, _messages.reverse());
      })
      .catch(err => {
        console.log(err);
      });
  }
  
  onMessage(msg) {
    msg = this.formatMessage(msg);
    this.mainWindow.webContents.send(msg.channel, msg);
  }
  
  sendCommand(channel, event, args) {
    if (!args || !args.type) {
      return;
    }
    
    switch (args.type) {
      case 'message':
        this.bot.sendMessage(channel.id, args.message);
        break;
      case 'typing':
        if (args.action === 'start') {
          this.bot.startTyping(args.channel.id);
        } else {
          this.bot.stopTyping(args.channel.id);
        }
        break;
      default:
        this.bot.sendMessage(channel.id, args.message);
        break;
    }
  }
}

module.exports = bot => {
  main = new Main(bot);
  return main;
};