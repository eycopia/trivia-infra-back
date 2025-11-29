const PlayerManager = require('../../src/managers/PlayerManager');
const db = require('../../db');

jest.mock('../../db');

describe('PlayerManager', () => {
    let session;

    beforeEach(() => {
        session = {
            players: {}
        };
        jest.clearAllMocks();
        db.query.mockResolvedValue({});
    });

    describe('addOrReconnectPlayer', () => {
        it('debe agregar un nuevo jugador', () => {
            const playerData = {
                name: 'Jorge',
                extra: 'Extra info',
                avatar: 'avatar.png',
                playerId: 'player123'
            };

            const player = PlayerManager.addOrReconnectPlayer(session, 'socket1', playerData);

            expect(player.name).toBe('Jorge');
            expect(player.playerId).toBe('player123');
            expect(session.players['socket1']).toBe(player);
        });

        it('debe reconectar un jugador existente', () => {
            // Agregar jugador inicial
            const playerData = {
                name: 'Jorge',
                extra: 'Extra info',
                avatar: 'avatar.png',
                playerId: 'player123'
            };

            const player1 = PlayerManager.addOrReconnectPlayer(session, 'socket1', playerData);

            // Reconectar con nuevo socket
            const player2 = PlayerManager.addOrReconnectPlayer(session, 'socket2', playerData);

            expect(player2).toBe(player1);
            expect(player2.id).toBe('socket2');
            expect(session.players['socket1']).toBeUndefined();
            expect(session.players['socket2']).toBe(player2);
        });

        it('debe usar socketId como playerId si no se proporciona', () => {
            const playerData = {
                name: 'Jorge',
                extra: '',
                avatar: ''
            };

            const player = PlayerManager.addOrReconnectPlayer(session, 'socket1', playerData);

            expect(player.playerId).toBe('socket1');
        });
    });

    describe('getPlayerCount', () => {
        it('debe retornar 0 si no hay jugadores', () => {
            expect(PlayerManager.getPlayerCount(session)).toBe(0);
        });

        it('debe retornar el número correcto de jugadores', () => {
            session.players['socket1'] = { id: 'socket1', name: 'Player1' };
            session.players['socket2'] = { id: 'socket2', name: 'Player2' };

            expect(PlayerManager.getPlayerCount(session)).toBe(2);
        });
    });

    describe('persistPlayer', () => {
        it('debe guardar el jugador en la DB', async () => {
            const player = {
                playerId: 'player123',
                name: 'Jorge',
                extra: 'Extra',
                avatar: 'avatar.png'
            };

            await PlayerManager.persistPlayer(player);

            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO players'),
                ['player123', 'Jorge', 'Extra', 'avatar.png']
            );
        });
    });
});
