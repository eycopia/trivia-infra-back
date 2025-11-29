const QuestionGameHandler = require('../../src/handlers/QuestionGameHandler');
const WinnerManager = require('../../src/managers/WinnerManager');

jest.mock('../../src/managers/WinnerManager');

describe('QuestionGameHandler', () => {
    let session;
    let mockIo;

    beforeEach(() => {
        session = {
            status: 'WAITING',
            currentQuestionIdx: -1,
            questionStartTime: 0,
            currentAnswers: [],
            players: {},
            questions: [
                { id: 1, t: '¿Pregunta 1?', options: ['A', 'B', 'C'], ans: 0 },
                { id: 2, t: '¿Pregunta 2?', options: ['X', 'Y', 'Z'], ans: 1 }
            ],
            gameSettings: { winners: 2, avoid_winners: true }
        };

        mockIo = {
            to: jest.fn().mockReturnThis(),
            emit: jest.fn()
        };

        jest.clearAllMocks();
    });

    describe('startQuestion', () => {
        it('debe iniciar una pregunta correctamente', () => {
            QuestionGameHandler.startQuestion(session, 0, mockIo, 'game1');

            expect(session.status).toBe('QUESTION');
            expect(session.currentQuestionIdx).toBe(0);
            expect(session.questionStartTime).toBeGreaterThan(0);
            expect(session.currentAnswers).toEqual([]);
            expect(mockIo.to).toHaveBeenCalledWith('game_game1');
            expect(mockIo.emit).toHaveBeenCalledWith('NEW_QUESTION', {
                t: '¿Pregunta 1?',
                options: ['A', 'B', 'C']
            });
        });

        it('debe limpiar flags de respuesta de jugadores', () => {
            session.players = {
                socket1: { id: 'socket1', hasAnsweredThisRound: true },
                socket2: { id: 'socket2', hasAnsweredThisRound: true }
            };

            QuestionGameHandler.startQuestion(session, 0, mockIo, 'game1');

            expect(session.players.socket1.hasAnsweredThisRound).toBe(false);
            expect(session.players.socket2.hasAnsweredThisRound).toBe(false);
        });

        it('debe lanzar error si la pregunta no existe', () => {
            expect(() => {
                QuestionGameHandler.startQuestion(session, 99, mockIo, 'game1');
            }).toThrow('Pregunta con índice 99 no encontrada');
        });
    });

    describe('submitAnswer', () => {
        beforeEach(() => {
            session.status = 'QUESTION';
            session.questionStartTime = Date.now();
            session.players = {
                socket1: { id: 'socket1', name: 'Player1', hasAnsweredThisRound: false }
            };
        });

        it('debe procesar una respuesta válida', () => {
            const result = QuestionGameHandler.submitAnswer(session, 'socket1', 0);

            expect(result).toBe(true);
            expect(session.currentAnswers).toHaveLength(1);
            expect(session.currentAnswers[0].answerIdx).toBe(0);
            expect(session.players.socket1.hasAnsweredThisRound).toBe(true);
        });

        it('debe rechazar respuesta si el jugador ya respondió', () => {
            session.players.socket1.hasAnsweredThisRound = true;

            const result = QuestionGameHandler.submitAnswer(session, 'socket1', 0);

            expect(result).toBe(false);
            expect(session.currentAnswers).toHaveLength(0);
        });

        it('debe rechazar respuesta si el estado no es QUESTION', () => {
            session.status = 'WAITING';

            const result = QuestionGameHandler.submitAnswer(session, 'socket1', 0);

            expect(result).toBe(false);
        });

        it('debe rechazar respuesta de jugador no existente', () => {
            const result = QuestionGameHandler.submitAnswer(session, 'nonexistent', 0);

            expect(result).toBe(false);
        });
    });

    describe('closeQuestion', () => {
        beforeEach(() => {
            session.status = 'QUESTION';
            session.currentQuestionIdx = 0;
            session.questionStartTime = Date.now() - 1000;
            session.players = {
                socket1: { id: 'socket1', name: 'Player1' },
                socket2: { id: 'socket2', name: 'Player2' },
                socket3: { id: 'socket3', name: 'Player3' }
            };
            session.currentAnswers = [
                { socketId: 'socket1', answerIdx: 0, timeDelta: 100, player: session.players.socket1 },
                { socketId: 'socket2', answerIdx: 1, timeDelta: 200, player: session.players.socket2 },
                { socketId: 'socket3', answerIdx: 0, timeDelta: 300, player: session.players.socket3 }
            ];
        });

        it('debe cerrar la pregunta y determinar ganadores', async () => {
            const mockWinners = [session.players.socket1, session.players.socket3];
            WinnerManager.selectQuestionWinners.mockResolvedValue(mockWinners);

            const result = await QuestionGameHandler.closeQuestion(session, mockIo, 'game1');

            expect(session.status).toBe('RESULT');
            expect(result.correctIdx).toBe(0);
            expect(result.roundWinners).toEqual(mockWinners);
            expect(mockIo.emit).toHaveBeenCalledWith('ROUND_RESULTS', expect.any(Object));
            expect(mockIo.emit).toHaveBeenCalledWith('LEADERBOARD_UPDATE', expect.any(Array));
        });

        it('debe filtrar solo respuestas correctas', async () => {
            WinnerManager.selectQuestionWinners.mockResolvedValue([]);

            await QuestionGameHandler.closeQuestion(session, mockIo, 'game1');

            const correctAnswersArg = WinnerManager.selectQuestionWinners.mock.calls[0][0];
            expect(correctAnswersArg).toHaveLength(2); // Solo socket1 y socket3 respondieron correctamente (ans: 0)
        });

        it('debe ordenar respuestas correctas por velocidad', async () => {
            WinnerManager.selectQuestionWinners.mockResolvedValue([]);

            await QuestionGameHandler.closeQuestion(session, mockIo, 'game1');

            const correctAnswersArg = WinnerManager.selectQuestionWinners.mock.calls[0][0];
            expect(correctAnswersArg[0].timeDelta).toBeLessThan(correctAnswersArg[1].timeDelta);
        });
    });
});
