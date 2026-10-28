'use strict';
// Entry point (`npm start`). The server itself lives in server/ — see server/index.js for the map.
const game = require('./server/index');
if (require.main === module) game.listen();
module.exports = game;
