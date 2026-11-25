import sendowl from './samples/sendowl.csv?raw';
import alva from './samples/alva.csv?raw';
import shopify from './samples/shopify-orders.csv?raw';

export const samples = {
  old: { name: 'sendowl.csv', text: sendowl },
  next: { name: 'alva.csv', text: alva },
  orders: { name: 'shopify-orders.csv', text: shopify },
};
