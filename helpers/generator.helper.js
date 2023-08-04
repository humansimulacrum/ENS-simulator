import crypto from 'crypto';

import { englishWords } from '../const/words.const.js';
import { randomIntInRange } from './general.helper.js';

export const generateSalt = () => {
  return '0x' + crypto.randomBytes(32).toString('hex');
};

export const generateName = () => {
  const wordCount = englishWords.length;
  return englishWords[randomIntInRange(0, wordCount)] + englishWords[randomIntInRange(0, wordCount)];
};
