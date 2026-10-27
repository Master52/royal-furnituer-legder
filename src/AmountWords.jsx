import React from 'react';
import {amountWords} from './amountWords.js';
export default function AmountWords({value}){
 const text=amountWords(value);
 return text?<small className="amount-words" aria-live="polite">{text}</small>:null;
}
