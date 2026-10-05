// Confirmed by the shop owner. Source IDs identify variants, not names or prices.
// Price units remain unconfirmed until reviewed separately.
export const confirmedMyBillBookUnits={
  '4d98ac88-29a7-4486-9814-79132b9cb557':{baseUnit:'KG',importUnit:'KG'},
  '3a31f69a-48f2-4710-968f-ed47719b824c':{baseUnit:'KG',importUnit:'KG'},
  'df5d9ff4-35ba-42d0-9510-d4ac0e6e5daa':{baseUnit:'KG',importUnit:'KG'},
  'b6b6ba7f-cf52-4b3d-b7aa-3bdb03312de6':{baseUnit:'PCS',importUnit:'BOX',secondaryUnit:'BOX',conversion:'1000'}
};
export function applyConfirmedStockUnits(row){
  const profile=confirmedMyBillBookUnits[row.sourceId];
  if(!profile||Object.entries(profile).some(([key,value])=>row[key]&&row[key]!==value))return row;
  return {...row,...profile};
}
