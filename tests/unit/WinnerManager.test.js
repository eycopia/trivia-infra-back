const WinnerManager = require('../../src/managers/WinnerManager');
const db = require('../../db');

jest.mock('../../db');

describe('WinnerManager', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('hasPlayerWonBefore', () => {
        it('debe retornar true si el jugador ya ganó', async () => {
            db.query.mockResolvedValue({ rows: [{ count: '2' }] });

            const result = await WinnerManager.hasPlayerWonBefore('player123');

            expect(result).toBe(true);
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT COUNT'),
                ['player123']
            );
        });

        it('debe retornar false si el jugador no ha ganado', async () => {
            db.query.mockResolvedValue({ rows: [{ count: '0' }] });

            const result = await WinnerManager.hasPlayerWonBefore('player123');

            expect(result).toBe(false);
        });
    });

    describe('selectQuestionWinners', () => {
        it('debe seleccionar ganadores por velocidad', async () => {
            const correctAnswers = [
                { player: { id: 'p1', playerId: 'player1', name: 'Player 1' }, timeDelta: 100 },
                { player: { id: 'p2', playerId: 'player2', name: 'Player 2' }, timeDelta: 200 },
                { player: { id: 'p3', playerId: 'player3', name: 'Player 3' }, timeDelta: 300 }
            ];

            const gameSettings = { winners: 2, avoid_winners: false };

            db.query.mockResolvedValue({});

            const winners = await WinnerManager.selectQuestionWinners(
                correctAnswers,
                gameSettings,
                'game1',
                0
            );

            expect(winners).toHaveLength(2);
            expect(winners[0].name).toBe('Player 1');
            expect(winners[1].name).toBe('Player 2');
        });

        it('debe excluir ganadores previos cuando avoid_winners=true', async () => {
            const correctAnswers = [
                { player: { id: 'p1', playerId: 'player1', name: 'Player 1' }, timeDelta: 100 },
                { player: { id: 'p2', playerId: 'player2', name: 'Player 2' }, timeDelta: 200 },
                { player: { id: 'p3', playerId: 'player3', name: 'Player 3' }, timeDelta: 300 }
            ];

            const gameSettings = { winners: 2, avoid_winners: true };

            // Player 1 ya ganó antes
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '1' }] }) // player1 ya ganó
                .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // player2 no ha ganado
                .mockResolvedValueOnce({}) // saveWinner player2
                .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // player3 no ha ganado
                .mockResolvedValueOnce({}); // saveWinner player3

            const winners = await WinnerManager.selectQuestionWinners(
                correctAnswers,
                gameSettings,
                'game1',
                0
            );

            expect(winners).toHaveLength(2);
            expect(winners[0].name).toBe('Player 2');
            expect(winners[1].name).toBe('Player 3');
        });

        it('debe respetar el límite de ganadores', async () => {
            const correctAnswers = [
                { player: { id: 'p1', playerId: 'player1', name: 'Player 1' }, timeDelta: 100 },
                { player: { id: 'p2', playerId: 'player2', name: 'Player 2' }, timeDelta: 200 }
            ];

            const gameSettings = { winners: 5, avoid_winners: false };

            db.query.mockResolvedValue({});

            const winners = await WinnerManager.selectQuestionWinners(
                correctAnswers,
                gameSettings,
                'game1',
                0
            );

            // Solo hay 2 respuestas correctas, aunque el límite sea 5
            expect(winners).toHaveLength(2);
        });
    });

    describe('selectLotteryWinners', () => {
        it('debe seleccionar ganadores aleatorios', async () => {
            const allPlayers = [
                { id: 'p1', playerId: 'player1', name: 'Player 1' },
                { id: 'p2', playerId: 'player2', name: 'Player 2' },
                { id: 'p3', playerId: 'player3', name: 'Player 3' }
            ];

            const gameSettings = { total_winners: 2, avoid_winners: false };

            db.query.mockResolvedValue({});

            const winners = await WinnerManager.selectLotteryWinners(
                allPlayers,
                gameSettings,
                'game1'
            );

            expect(winners).toHaveLength(2);
            expect(db.query).toHaveBeenCalledTimes(2); // 2 saveWinner calls
        });

        it('debe lanzar error si no hay jugadores', async () => {
            const gameSettings = { total_winners: 2, avoid_winners: false };

            await expect(
                WinnerManager.selectLotteryWinners([], gameSettings, 'game1')
            ).rejects.toThrow('No hay jugadores disponibles para el sorteo');
        });

        it('debe excluir ganadores previos cuando avoid_winners=true', async () => {
            const allPlayers = [
                { id: 'p1', playerId: 'player1', name: 'Player 1' },
                { id: 'p2', playerId: 'player2', name: 'Player 2' },
                { id: 'p3', playerId: 'player3', name: 'Player 3' }
            ];

            const gameSettings = { total_winners: 2, avoid_winners: true };

            // Player 1 ya ganó antes
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '1' }] }) // player1 ya ganó
                .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // player2 no ha ganado
                .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // player3 no ha ganado
                .mockResolvedValue({}); // saveWinner calls

            const winners = await WinnerManager.selectLotteryWinners(
                allPlayers,
                gameSettings,
                'game1'
            );

            expect(winners).toHaveLength(2);
            // Player 1 no debe estar en los ganadores
            expect(winners.find(w => w.playerId === 'player1')).toBeUndefined();
        });
    });

    describe('saveWinner', () => {
        it('debe guardar un ganador en la DB', async () => {
            const player = { playerId: 'player123', name: 'Jorge' };

            db.query.mockResolvedValue({});

            await WinnerManager.saveWinner('game1', player, 0);

            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO winners'),
                ['game1', 'player123', 'Jorge', 0]
            );
        });

        it('debe guardar con question_idx null para lottery', async () => {
            const player = { playerId: 'player123', name: 'Jorge' };

            db.query.mockResolvedValue({});

            await WinnerManager.saveWinner('game1', player, null);

            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO winners'),
                ['game1', 'player123', 'Jorge', null]
            );
        });
    });
});
