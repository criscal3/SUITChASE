import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';

type Role = 'ADMIN' | 'AEROLINEA';

export class RealTimeWebSocketClient {
    private client: Client;
    private subs: any[] = [];

    constructor(
        private role: Role,
        private aerolineaId?: number,
        private callbacks: {
            onNuevoPedido?: (p: any) => void;
            onActualizacion?: (r: any) => void;
            onPedidosActualizados?: (list: any[]) => void;
            onMisPedidos?: (list: any[]) => void;
        } = {}
    ) {
        this.client = new Client({
            webSocketFactory: () => new SockJS('/ws'),
            reconnectDelay: 5000,
        });

        this.client.onConnect = () => {
            if (role === 'ADMIN') {
                this.subs.push(this.client.subscribe('/topic/tiempo-real/nuevo-pedido',
                    msg => this.callbacks.onNuevoPedido?.(JSON.parse(msg.body))));
                this.subs.push(this.client.subscribe('/topic/tiempo-real/actualizacion',
                    msg => this.callbacks.onActualizacion?.(JSON.parse(msg.body))));
                this.subs.push(this.client.subscribe('/topic/tiempo-real/pedidos-actualizados',
                    msg => this.callbacks.onPedidosActualizados?.(JSON.parse(msg.body))));
            }
            if (role === 'AEROLINEA' && aerolineaId) {
                this.subs.push(this.client.subscribe(`/topic/mis-pedidos/${aerolineaId}`,
                    msg => this.callbacks.onMisPedidos?.(JSON.parse(msg.body))));
            }
        };
    }

    connect() { this.client.activate(); }
    disconnect() {
        this.subs.forEach(s => s.unsubscribe());
        this.subs = [];
        this.client.deactivate();
    }
}
