"use strict";

const fs = require('fs');
const path = require('path');
const electron = require('electron');
const ipcMain = require('electron').ipcMain;
const moment = require('moment');
const _ = require('underscore');
const Datastore = require('nedb');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const Menu = require('electron').Menu;
const appMenu = require('./appMenu')(app);

let main;

class Main {
  
  constructor(bot) {
    this.mainWindow = null;
    this.bot = bot;
    this.activeChannel = null;
    
    // debug: print userData path so we know where data files are being stored locally
    console.log(app.getPath('userData'));

    // Create the nedb config db
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
  
  /**
   * Login with token or show the token window
   */
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
  
  /**
   * Save the token for logging in
   * @param  {Object} event ipc event object
   * @param  {String} token token entered by the user
   */
  saveToken(event, token) {
    this.config.update({}, {token: token}, {upsert: true}, (err, n) => {
      this.login();
      this.tokenWindow.close();
    });
  }
  
  /**
   * Create the token window
   */
  createTokenWindow() {
    this.tokenWindow = new BrowserWindow({width: 650, height: 100});
    this.tokenWindow.loadURL('file://' + __dirname + '/token.html');

    Menu.setApplicationMenu(Menu.buildFromTemplate(appMenu));
    
    // Register the event listener to save token
    ipcMain.on('token', this.saveToken.bind(this));
  }
  
  /**
   * Create the client window
   */
  createWindow() {
    this.mainWindow = new BrowserWindow({width: 1280, height: 720});
    this.mainWindow.loadURL('file://' + __dirname + '/index.html');

    // Open the DevTools.
    // this.mainWindow.webContents.openDevTools();

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });
    
    // create the client menu
    Menu.setApplicationMenu(Menu.buildFromTemplate(appMenu));
    
    app.mainWindow = this.mainWindow;
  }
  
  /**
   * Bot ready event handler
   */
  onReady() {
    // load servers
    this.bot.servers.forEach(server => {
      this.createServer(server);
    });
  }
  
  /**
   * Register servers with the client
   * @param  {Object} server discord.js server resolvable
   */
  createServer(server) {
    // clone server to prevent modification of the discord.js servers cache
    let _server = _.clone(server),
        _channels = {};
    
    server.channels.forEach(channel => {
      if (channel.type !== 'text') {
        return;
      }

      // ignore channels the user doesn't have permissions to read
      if (!channel.permissionsOf(this.bot.user).serialize().readMessages) return;
      
      // cone channel to prevent modification of the discord.js channels cache
      _channels[channel.id] = _.clone(channel);
      
      // register an ipc listener for this channel
      ipcMain.on(channel.id, this.sendCommand.bind(this, _channels[channel.id]));
    });
    
    _server.channels = _channels;
    
    // send the server create event to the client
    this.mainWindow.webContents.send('server-create', _server);
  }
  
  /**
   * Handle the serverDeleted event
   * @param  {Object} server discord.js server resolvable
   */
  deleteServer(server) {
    // send the server delete event to the client
    this.mainWindow.webContents.send('server-delete', server);
  }
  
  /**
   * Handle the channelCreated event
   * @param  {Object} channel discord.js channel resolvable
   */
  createChannel(channel) {
    // send the server update event that will update channels and handle positioning, etc
    this.mainWindow.webContents.send('server-update', channel.server);
    // register an ipc listener for this channel
    ipcMain.on(channel.id, this.sendCommand.bind(this, _channels[channel.id]));
  }
  
  /**
   * Handle the channelDeleted event
   * @param  {Object} channel discord.js channel resolvable
   */
  deleteChannel(channel) {
    this.mainWindow.webContents.send('server-update', channel.server);
  }
  
  /**
   * Utility method to format message objects
   * This should return an object with no circular references.
   * 
   * @param  {Object} message discord.js message resovable
   * @return {Object}         the message object to send to the client.
   */
  formatMessage(message) {
    let msg = _.clone(message);
    
    // we don't need this reference
    delete msg.client;
    
    // format the timestamp for display
    msg.timestamp = moment.unix(msg.timestamp / 1000).format('hh:mm:ss a');
    
    // get roles of author
    msg.author.roles = msg.channel.server.rolesOfUser(msg.author);

    // map role colors as hex
    msg.author.roles = msg.author.roles.map(role => {
      role = _.clone(role);
      role.color = role.colorAsHex() === '#000000' ? '#fefefe' : role.colorAsHex();
      return role;
    });
    
    // we only need the channel id, and the object contains circular references
    msg.channel = msg.channel.id;

    // pick the keys we need and don't return circular references
    msg.author = _.pick(msg.author, ['id', 'username', 'discriminator', 'avatar', 'roles' ]);
    
    return msg;
  }
  
  /**
   * Activate a channel and get channel logs
   * @param  {Object} event   ipc event object
   * @param  {Object} channel channel object
   */
  activateChannel(event, channel) {
    this.activeChannel = channel;
    // get last 50 messages for this channel
    this.bot.getChannelLogs(channel.id, 50)
      .then(messages => {
        // format the messages so they can be sent through ipc without circular references
        let _messages = messages.map(this.formatMessage);
        event.sender.send(channel.id, _messages.reverse());
      })
      .catch(err => {
        console.log(err);
      });
  }
  
  /**
   * Bot message event handler
   * @param  {Object} msg discord.js message resolvable
   */
  onMessage(msg) {
    // ignore messages messages not in the active channel
    if (this.activeChannel && this.activeChannel.id !== msg.channel.id) {
      return;
    }

    msg = this.formatMessage(msg);
    this.mainWindow.webContents.send(msg.channel, msg);
  }
  
  /**
   * Send commands from the client to discord
   * @param  {Object} channel channel object
   * @param  {Object} event   ipc event
   * @param  {Object} cmd     command data
   * @return {[type]}         [description]
   */
  sendCommand(channel, event, cmd) {
    if (!cmd || !cmd.type) {
      return;
    }
    
    switch (cmd.type) {
      case 'message':
        this.bot.sendMessage(channel.id, cmd.message);
        break;
      case 'typing':
        if (cmd.action === 'start') {
          this.bot.startTyping(cmd.channel.id);
        } else {
          this.bot.stopTyping(cmd.channel.id);
        }
        break;
      default:
        this.bot.sendMessage(channel.id, cmd.message);
        break;
    }
  }
}

module.exports = bot => {
  main = new Main(bot);
  return main;
};