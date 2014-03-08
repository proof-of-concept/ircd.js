var crypto = require('crypto'),
    base58 = require('base58-native');


var COIN_VERSION_NUMBER = '00'; // 00 = Bitcoin

module.exports = {
  isValidAddress: function(addr) {
    try {
      var hex = base58.decode(addr);
      if (hex.slice(0, 1).toString('hex') === COIN_VERSION_NUMBER) {
        var arb = hex.slice(0, 21);
        var stage1 = crypto.createHash('sha256').update(new Buffer(arb, 'hex')).digest('hex');
        var stage2 = new Buffer(crypto.createHash('sha256').update(new Buffer(stage1, 'hex')).digest('hex'), 'hex');
        var stageChksum = stage2.slice(0, 4).toString('hex');
        var chksum = hex.slice(21, 25).toString('hex');
        return (stageChksum === chksum);
      }
    } catch (e) {
    }
    return false;
  }
};