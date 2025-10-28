/**
 * WebSocket polyfill for Node.js environments
 * 
 * The Sui SDK requires a global WebSocket implementation for event subscriptions.
 * Node.js does not provide a global WebSocket, so we use the 'ws' package as a polyfill.
 * 
 * This module must be imported before any Sui client or subscription code is initialized.
 */

// Only polyfill if WebSocket is not already defined
if (typeof globalThis.WebSocket === 'undefined') {
  // Import ws package
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const WebSocketImpl = require('ws');
  
  // Assign to globalThis.WebSocket
  (globalThis as any).WebSocket = WebSocketImpl;
}
