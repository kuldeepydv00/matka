const crypto = require('crypto');

// Generate a random server seed
const generateServerSeed = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Hash the server seed to publish before the draw
const hashServerSeed = (serverSeed) => {
  return crypto.createHash('sha256').update(serverSeed).digest('hex');
};

// Calculate the winning number based on server seed, optional client seeds, and draw time
// Using a simplified but deterministic approach for 1-100
const calculateWinningNumber = (serverSeed, clientSeedsString = '', drawTimeString) => {
  const hashString = `${serverSeed}:${clientSeedsString}:${drawTimeString}`;
  const hash = crypto.createHash('sha256').update(hashString).digest('hex');
  
  // Take first 8 chars of hash, parse as integer, modulo 100, add 1
  const subHash = hash.substring(0, 8);
  const intVal = parseInt(subHash, 16);
  
  return (intVal % 100) + 1;
};

module.exports = { generateServerSeed, hashServerSeed, calculateWinningNumber };
