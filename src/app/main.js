"use strict";

const fs = require('fs');
const path = require('path');
const moment = require('moment');
const Datastore = require('nedb');
const electron = require('electron');
const BrowserWindow = electron.BrowserWindow;
const ipcMain = electron.ipcMain;
const app = electron.app;
const Menu = electron.Menu;
const appMenu = require('./appMenu')(app);

let main;

class Main {
  
  constructor(bot) {
    this.bot = bot;
    this.mainWindow = null;
    this.activeChannel = null;
    this.retries = 0;
    
    // debug: print userData path so we know where data files are being stored locally
    console.log(app.getPath('userData'));

    // Create the nedb config db
    this.config = new Datastore({
      filename: path.join(app.getPath('userData'), 'config.db'),
      autoload: true
    });

    app.config = {};
    
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
    bot.on('error', this.onError.bind(this));
    bot.on('disconnected', this.onDisconnect.bind(this));
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
      this.bot.loginWithToken(this.token).then(() => {
        if (!this.mainWindow) {
          this.createWindow();
        }
      }).catch(err => console.log(err));
    });
  }

  /**
   * Client ready event handler
   */
  onReady() {
    // load servers
    this.bot.servers.forEach(server => {
      this.createServer(server);
    });
  }

  /**
   * Client error event handler
   * @param  {Object} err Error
   */
  onError(err) {
    console.error(err);
  }

  /**
   * Client disconnect event handler
   */
  onDisconnect() {
    // retry 3 times
    if (this.retries >= 3) {
      this.retries = 0;
      return this.createTokenWindow();
    }

    this.retries++;

    // debug
    console.log(`Attempting to reconnect... ${this.retries}`);

    // respect reconnect rate limit of 5s
    setTimeout(function() {
      this.login();
    }.bind(this), 5000);
  }
  
  /**
   * Save the token for logging in
   * @param  {Object} event ipc event object
   * @param  {String} token token entered by the user
   */
  saveToken(event, token) {
    let callback = err => {
      this.login();
      if (this.tokenWindow) this.tokenWindow.close();
    };

    this.config.findOne({}, (err, doc) => {
      if (!doc) {
        app.config = {token};
        this.config.insert({token}, callback);
      } else {
        doc.token = token;
        app.config = doc;
        this.config.update({ _id: doc._id }, doc, callback);
      }
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
   * Register servers with the client
   * @param  {Object} server discord.js server resolvable
   */
  createServer(server) {
    // clone server to prevent modification of the discord.js servers cache
    let _server = Object.assign({}, server),
        _channels = {};
    
    for (let channel of server.channels) {
      if (channel.type !== 'text') {
        continue;
      }

      // ignore channels the user doesn't have permissions to read
      if (!channel.permissionsOf(this.bot.user).serialize().readMessages) continue;
      
      // clone channel to prevent modification of the discord.js channels cache
      _channels[channel.id] = Object.assign({}, channel);
      
      // register an ipc listener for this channel
      ipcMain.on(channel.id, this.sendCommand.bind(this, _channels[channel.id]));
    }
    
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
    let msg = Object.assign({}, message);
    
    // we don't need this reference
    delete msg.client;
    
    // format the timestamp for display
    msg.timestamp = moment.unix(msg.timestamp / 1000).format('hh:mm:ss a');
    
    // get roles of author
    msg.author.roles = msg.channel.server.rolesOfUser(msg.author);

    // map role colors as hex
    msg.author.roles = msg.author.roles.map(role => {
      // clone role to so there's no reference overwrites
      let _role = Object.assign({}, role);
      _role.color = role.colorAsHex() === '#000000' ? '#fefefe' : role.colorAsHex();
      return _role;
    });
    
    // we only need the channel id, and the object contains circular references
    msg.channel = msg.channel.id;

    // pick the keys we need and don't return circular references
    msg.author = {
      id: msg.author.id,
      username: msg.author.username,
      discriminator: msg.author.discriminator,
      avatar: msg.author.avatar,
      roles: msg.author.roles
    };
    
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
    // ignore if client hasn't loaded yet
    if (!this.mainWindow) return;

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
      // send message to discord
      case 'message':
        this.bot.sendMessage(channel.id, cmd.message);
        break;
      // send typing status, see caution on the client-side
      case 'typing':
        if (cmd.action === 'start') {
          this.bot.startTyping(cmd.channel.id);
        } else {
          this.bot.stopTyping(cmd.channel.id);
        }
        break;
      // idk why this is duplicated
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