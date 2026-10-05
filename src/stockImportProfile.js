// Confirmed by the shop owner. Source IDs identify variants, not names or prices.
// Price units remain unconfirmed until reviewed separately.
export const confirmedMyBillBookUnits={
  '4d98ac88-29a7-4486-9814-79132b9cb557':{baseUnit:'KG',importUnit:'KG'},
  '3a31f69a-48f2-4710-968f-ed47719b824c':{baseUnit:'KG',importUnit:'KG'},
  'df5d9ff4-35ba-42d0-9510-d4ac0e6e5daa':{baseUnit:'KG',importUnit:'KG'},
  'b6b6ba7f-cf52-4b3d-b7aa-3bdb03312de6':{baseUnit:'PCS',importUnit:'BOX',secondaryUnit:'BOX',conversion:'1000'},
  '13606a1b-437b-4d9b-b535-2dc9281bb408':{baseUnit:'PCS',importUnit:'PACKET',secondaryUnit:'PACKET',conversion:'250'},
  'd832ba5d-1e6b-4d13-9ca1-d84df520f6ec':{baseUnit:'PCS',importUnit:'BOX',secondaryUnit:'BOX',conversion:'20'},
  '5ae29610-e9be-4ffe-b0f7-1192585052f0':{baseUnit:'PCS',importUnit:'BOX',secondaryUnit:'BOX',conversion:'20'},
  'd1d287a0-b77d-4f94-9c0d-a736ed1b1ec2':{baseUnit:'PCS',importUnit:'BORI',secondaryUnit:'BORI',conversion:'200'},
  'dba29746-fdbe-4dca-91c7-89898ab7f8d5':{baseUnit:'PCS',importUnit:'PACKET',secondaryUnit:'PACKET',conversion:'25'},
  'ee32450c-8183-410f-a772-99a03316ba90':{baseUnit:'PCS',importUnit:'PACKET',secondaryUnit:'PACKET',conversion:'30'},
  'ec2d7a2c-4910-41f3-b459-9a5b9e239cf4':{baseUnit:'PCS',importUnit:'PACKET',secondaryUnit:'PACKET',conversion:'50'}
};
export function applyConfirmedStockUnits(row){
  const profile=confirmedMyBillBookUnits[row.sourceId];
  if(!profile||Object.entries(profile).some(([key,value])=>row[key]&&row[key]!==value))return row;
  return {...row,...profile};
}
