/**
 * BaseStrategy
 * Abstract base class for cryptographic encryption strategies.
 */
class BaseStrategy {
  /**
   * @param {string} name - Algorithm identifier ('pgp' | 'rsa' | 'aes')
   */
  constructor(name) {
    if (new.target === BaseStrategy) {
      throw new TypeError('BaseStrategy is abstract and cannot be instantiated directly.');
    }
    this.name = name;
  }

  /**
   * Encrypt plaintext buffer using strategy algorithm
   * @param {Buffer} buffer 
   * @param {Object} config 
   * @returns {Promise<Buffer>}
   */
  async encrypt(buffer, config) {
    throw new Error(`encrypt() is not implemented for strategy '${this.name}'`);
  }

  /**
   * Decrypt ciphertext buffer using strategy algorithm
   * @param {Buffer} buffer 
   * @param {Object} config 
   * @returns {Promise<Buffer>}
   */
  async decrypt(buffer, config) {
    throw new Error(`decrypt() is not implemented for strategy '${this.name}'`);
  }

  /**
   * Inspect if buffer matches strategy signature
   * @param {Buffer} buffer 
   * @returns {boolean}
   */
  hasValidSignature(buffer) {
    return false;
  }

  /**
   * Validate strategy requirements against config
   * @param {Object} config 
   * @returns {boolean}
   */
  isEnabled(config) {
    return false;
  }
}

module.exports = BaseStrategy;
