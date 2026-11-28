export const plans = [
  { id:'FREE', monthly:0, yearly:0, employees:0, products:100, branches:1, aiPerDay:5 },
  { id:'START', monthly:39000, yearly:449000, employees:0, products:500, branches:1, aiPerDay:15 },
  { id:'STANDARD', monthly:119000, yearly:1299000, employees:3, products:2000, branches:1, aiPerDay:30 },
  { id:'PLUS', monthly:249000, yearly:2599000, employees:10, products:10000, branches:3, aiPerDay:60 },
  { id:'PRO', monthly:599000, yearly:5999000, employees:50, products:50000, branches:10, aiPerDay:150 },
  { id:'PREMIUM', monthly:1219000, yearly:10999000, employees:null, products:null, branches:null, aiPerDay:300 },
] as const;
// SQL migrations enforce entitlements independently of this UI catalogue.
