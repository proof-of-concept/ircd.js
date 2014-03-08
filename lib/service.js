var dns = require('dns'),
    winston = require('winston'),
    irc = require('./protocol');

function Service(ircServer) {
  this.server = ircServer;
  this.config = ircServer.config;
  this.nick = null;
  this.username = null;
  this.realname = null;
  this.channels = [];
  this.quitMessage = 'Connection lost';
  this.disconnected = false;
  this.pendingAuth = false;
  this.passwordAccepted = false;
  this.lastPing = null;
  this.postAuthQueue = [];
  this.registered = false;
  this._modes = [];
  this.channelModes = {};
  this.serverName = '';
  this.created = new Date() / 1000;
  this.updated = new Date();
  this.isAway = false;
  this.awayMessage = null;
  this.serverOper = false;
  this.localOper = false;
  this.hopCount = 0;
  this.servertoken = null;
}

Service.prototype = {
  get id() {
    return this.nick;
  },

  get mask() {
    return ':' + this.nick + '!' + this.username + '@' + this.hostname;
  },

  get modes() {
    return '+' + this._modes.join(''); 
  },

  set modes(modes) {
    if (modes) {
      modes = modes.replace(/^\+/, '');
      this._modes = modes.split('');
    }
  },

  get idle() {
    return parseInt(((new Date()) - this.updated) / 1000, 10);
  },

  get isOper() {
    return true;
  },

  get isInvisible() {
    return this.modes.indexOf('i') !== -1;
  },

  send: function() {
    if (!this.stream) return;

    var self = this,
        message = arguments.length === 1 ?
          arguments[0]
        : Array.prototype.slice.call(arguments).join(' ');

    winston.log('S: [' + this.nick + '] ' + message);

    try {
      this.stream.write(message + '\r\n');
    } catch (exception) {
      winston.error('[' + this.nick + '] error writing to stream:', exception);

      // This setTimeout helps prevent against race conditions when multiple clients disconnect at the same time
      setTimeout(function() {
        if (!self.disconnected) {
          self.disconnected = true;
          self.server.disconnect(self);
        }
      }, 1);
    }
  },

  expandMask: function(mask) {
    return mask.replace(/\./g, '\\.').
                replace(/\*/g, '.*');
  },

  matchesMask: function(mask) {
    var parts = mask.match(/([^!]*)!([^@]*)@(.*)/) || [],
        matched = true,
        lastPart = parts.length < 4 ? parts.length : 4;
    parts = parts.slice(1, lastPart).map(this.expandMask);

    if (!this.nick.match(parts[0])) {
      return false;
    } else if (!this.username.match(parts[1])) {
      return false;
    } else if (!this.hostname.match(parts[2])) {
      return false;
    } else {
      return true;
    }
  },

  sharedChannelWith: function(targetUser) {
    return false;
  },

  channelNick: function(channel) {
    return '@' + this.nick;
  },

  channelPrivilege: function(channel) {
    return 'H@*';
  },

  isOp: function(channel) {
    return true;
  },

  op: function(channel) {
    return;
  },

  deop: function(channel) {
    return;
  },

  oper: function() {
    return;
  },

  deoper: function() {
    return;
  },

  isHop: function(channel) {
    return true;
  },

  hop: function(channel) {
    return;
  },

  dehop: function(channel) {
    return;
  },

  isVoiced: function(channel) {
    return true;
  },

  voice: function(channel) {
    return;
  },

  devoice: function(channel) {
    return;
  },

  hostLookup: function() {
    return;
  },

  register: function() {
    if (this.registered === false
        && this.nick
        && this.username) {
      
      this.serverName = this.config.name;
      this.send(this.server.host, irc.reply.welcome, this.nick, 'Service connected to ' + this.config.network + ' IRC network', this.mask);
      this.send(this.server.host, irc.reply.yourHost, this.nick, 'Service host is', this.config.hostname, 'running version', this.server.version);
      this.send(this.server.host, irc.reply.myInfo, this.nick, this.config.name, this.server.version);
      
      //dns.reverse(this.remoteAddress, function(err, addresses) {
      //this.hostname = addresses && addresses.length > 0 ? addresses[0] : this.remoteAddress;
      //});
      this.hostname = this.remoteAddress;

      this.registered = true;
      this.addMode.w.apply(this);
      this.addMode.o.apply(this);

      this.server.users.register(this, this.username, this.hostname, this.serverName, this.realname);

      this._modes.push('o');
      this.send(this.mask, 'MODE', this.nick, '+o', this.nick);
      this.localOper = true;
      this.serverOper = true;
    }
  },

  message: function(nick, message) {
    var user = this.server.users.find(nick);
    this.updated = new Date();

    if (user) {
      if (user.isAway) {
        this.send(this.server.host, irc.reply.away, this.nick, user.nick, ':' + user.awayMessage);
      }
      user.send(this.mask, 'PRIVMSG', user.nick, ':' + message);
    } else {
      this.send(this.server.host, irc.errors.noSuchNick, this.nick, nick, ':No such nick/channel');
    }
  },

  addModes: function(user, modes, arg) {
    var thisUser = this;
    modes.slice(1).split('').forEach(function(mode) {
      if (thisUser.addMode[mode])
        thisUser.addMode[mode].apply(thisUser, [user, arg]);
    });
  },

  addMode: {
    i: function(user, arg) {
      if (this.isOper || this === user) {
        if (!user.modes.match(/i/)) {
          user._modes.push('i');
          user.send(user.mask, 'MODE', this.nick, '+i', user.nick);
          if (this !== user) {
            this.send(this.mask, 'MODE', this.nick, '+i', user.nick);
          }
        }
      } else {
        this.send(this.server.host, irc.errors.usersDoNotMatch, this.nick, user.nick, ':Cannot change mode for other users');
      }
    },

    o: function() {
      // Can only be issued by OPER
    },

    w: function() {
      if (!this.modes.match(/w/)) {
        this._modes.push('w');
        this.send(this.mask, 'MODE', this.nick, '+w', this.nick);
      }
    },

    x: function() {
      if (!this.modes.match(/x/)) {
        this._modes.push('x');
        this.send(this.mask, 'MODE', this.nick, '+w', this.nick);
        this.send(this.mask, irc.reply.yourHost, this.nick, 'Masking your host', this.nick);
        this.hostname = 'masked';
      }
    }
  },

  removeModes: function(user, modes, arg) {
    var thisUser = this;
    modes.slice(1).split('').forEach(function(mode) {
      if (thisUser.removeMode[mode])
        thisUser.removeMode[mode].apply(thisUser, [user, arg]);
    });
  },

  removeMode: {
    i: function(user, arg) {
      if (this.isOper || this === user) {
        if (user.modes.match(/i/)) {
          user._modes.splice(user._modes.indexOf('i'), 1);
          user.send(user.mask, 'MODE', this.nick, '-i', user.nick);
          if (this !== user) {
            this.send(this.mask, 'MODE', this.nick, '-i', user.nick);
          }
        }
      } else {
        this.send(this.server.host, irc.errors.usersDoNotMatch, this.nick, user.nick, ':Cannot change mode for other users');
      }
    },

    o: function() {
      if (this.modes.match(/o/)) {
        user._modes.splice(user._modes.indexOf('o'), 1);
        this.send(this.mask, 'MODE', this.nick, '-o', this.nick);
      }
    },

    w: function() {
      if (this.modes.match(/w/)) {
        user._modes.splice(user._modes.indexOf('w'), 1);
        this.send(this.mask, 'MODE', this.nick, '-w', this.nick);
      }
    }
  },

  queue: function(message) {
    this.postAuthQueue.push(message);
  },

  runPostAuthQueue: function() {
    if (!this.passwordAccepted) return;

    var self = this;

    this.postAuthQueue.forEach(function(message) {
      self.server.respondToMessage(self, message);
    });
  },

  hasTimedOut: function() {
    return false;
  },

  closeStream: function() {
    if (this.stream && this.stream.end) {
      this.stream.end();
    }
  },

  quit: function(message) {
    this.quitMessage = message;
    this.closeStream();
  }
};

exports.Service = Service;
