## Discord Botclient

> **Warning**: This client is under development and is provided as-is with no warantee. 

Have you ever wanted a superior alternative to the native discord client? 
If so, look no further!

This is a client for discord that uses [Electron](https://electron.atom.io) and [eris](https://github.com/ababahaha/eris)

## Installing

To install Discord Bot Client, either clone this repo or download and extract the zip file: 

`git clone https://github.com/briantanner/discord-botclient.git`

Run `npm install` to get dependencies.

This software runs under *Electron* and, for now, it must be installed globally: 

`npm install electron-prebuilt -global`

## Running

To start the app, run `electron index.js` in the `src` folder.

On the first execution, a dialog pops up. Enter your **bot secret token** and click OK. 
The dialog will close, run `electron index.js` again to actually open it. 

You're done! Enjoy :P
