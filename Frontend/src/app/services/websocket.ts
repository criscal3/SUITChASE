import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';

const WEBSOCKET_URL = '/ws';

export class SimulationWebSocketClient {
  private client: Client;
  private onMessageCallback: ((message: any) => void) | null = null;
  private onConnectCallback: (() => void) | null = null;
  private onDisconnectCallback: (() => void) | null = null;

  constructor(private simulacionId: number) {
    this.client = new Client({
      webSocketFactory: () => new SockJS(WEBSOCKET_URL),
      debug: (str) => {
        // console.log(str); // Uncomment for STOMP debugging
      },
      reconnectDelay: 5000,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
    });

    this.client.onConnect = () => {
      console.log(`STOMP Connected to simulation ${simulacionId}`);
      if (this.onConnectCallback) this.onConnectCallback();
      
      this.client.subscribe(`/topic/simulacion/${simulacionId}`, (message) => {
        if (message.body && this.onMessageCallback) {
          const parsed = JSON.parse(message.body);
          this.onMessageCallback(parsed);
        }
      });
    };

    this.client.onStompError = (frame) => {
      console.error('Broker reported error: ' + frame.headers['message']);
      console.error('Additional details: ' + frame.body);
    };

    this.client.onWebSocketClose = () => {
      console.log('WebSocket connection closed');
      if (this.onDisconnectCallback) this.onDisconnectCallback();
    };
  }

  onMessage(callback: (message: any) => void) {
    this.onMessageCallback = callback;
  }

  onConnect(callback: () => void) {
    this.onConnectCallback = callback;
  }

  onDisconnect(callback: () => void) {
    this.onDisconnectCallback = callback;
  }

  connect() {
    this.client.activate();
  }

  disconnect() {
    this.client.deactivate();
  }
}
