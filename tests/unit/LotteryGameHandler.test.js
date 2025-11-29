const LotteryGameHandler = require('../../src/handlers/LotteryGameHandler');
const WinnerManager = require('../../src/managers/WinnerManager');

jest.mock('../../src/managers/WinnerManager');

describe('LotteryGameHandler', () => {
    let session;
    let mockIo;

    beforeEach(() => {
        session = {
            status: 'WAITING',
            players: {
                socket1: { id: 'socket1', playerId: 'player1', name: 'Player 1' },
                socket2: { id: 'socket2', playerId: 'player2', name: 'Player 2' },
                socket3: { id: 'socket3', playerId: 'player3', name: 'Player 3' }
            },
            gameSettings: {
                game_kind: 'lottery',
                total_winners: 2,
                avoid_winners: true
            }
        };

        mockIo = {
            to: jest.fn().mockReturnThis(),
            emit: jest.fn()
        };

        jest.clearAllMocks();
    });

    describe('executeLottery', () => {
        it('debe ejecutar el sorteo correctamente', async () => {
            const mockWinners = [
                session.players.socket1,
                session.players.socket2
            ];
            WinnerManager.selectLotteryWinners.mockResolvedValue(mockWinners);

            const result = await LotteryGameHandler.executeLottery(session, mockIo, 'game1');

            expect(session.status).toBe('RESULT');
            expect(result.lotteryWinners).toEqual(mockWinners);
            expect(result.isLottery).toBe(true);
            expect(mockIo.to).toHaveBeenCalledWith('game_game1');
            expect(mockIo.emit).toHaveBeenCalledWith('LOTTERY_RESULTS', result);
        });

        it('debe lanzar error si no es un juego tipo lottery', async () => {
            session.gameSettings.game_kind = 'questions';

            await expect(
                LotteryGameHandler.executeLottery(session, mockIo, 'game1')
            ).rejects.toThrow('Este juego no es tipo lottery');
        });

        it('debe lanzar error si no hay jugadores conectados', async () => {
            session.players = {};

            await expect(
                LotteryGameHandler.executeLottery(session, mockIo, 'game1')
            ).rejects.toThrow('No hay jugadores conectados para el sorteo');
        });

        it('debe pasar todos los jugadores a WinnerManager', async () => {
            WinnerManager.selectLotteryWinners.mockResolvedValue([]);

            await LotteryGameHandler.executeLottery(session, mockIo, 'game1');

            expect(WinnerManager.selectLotteryWinners).toHaveBeenCalledWith(
                expect.arrayContaining([
                    session.players.socket1,
                    session.players.socket2,
                    session.players.socket3
                ]),
                session.gameSettings,
                'game1'
            );
        });

        it('debe guardar el resultado en lastRoundResult', async () => {
            const mockWinners = [session.players.socket1];
            WinnerManager.selectLotteryWinners.mockResolvedValue(mockWinners);

            await LotteryGameHandler.executeLottery(session, mockIo, 'game1');

            expect(session.lastRoundResult).toBeDefined();
            expect(session.lastRoundResult.lotteryWinners).toEqual(mockWinners);
            expect(session.lastRoundResult.isLottery).toBe(true);
        });
    });
});
