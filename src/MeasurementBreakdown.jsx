import React from 'react';
import {measurementText,measurementQuantityText} from './measurements.js';

export default function MeasurementBreakdown({item}){
  if(!item.measurements?.length)return null;
  return <span className="measurement-breakdown">{item.measurements.map((row,index)=><small key={index}>{measurementText(item,row)} → {measurementQuantityText(item,row)}<br/></small>)}</span>;
}
