const GameSessionManager = require('../../src/managers/GameSessionManager');
const db = require('../../db');

// Mock del módulo db
jest.mock('../../db');

describe('GameSessionManager', () => {
    let manager;

    beforeEach(() => {
        manager = new GameSessionManager();
        jest.clearAllMocks();
    });

    describe('getOrCreateSession', () => {
        it('debe crear una nueva sesión si no existe', () => {
            const session = manager.getOrCreateSession('game1');

            expect(session).toBeDefined();
            expect(session.status).toBe('WAITING');
            expect(session.currentQuestionIdx).toBe(-1);
            expect(session.players).toEqual({});
            expect(session.questions).toEqual([]);
        });

        it('debe retornar la sesión existente si ya fue creada', () => {
            const session1 = manager.getOrCreateSession('game1');
            session1.status = 'QUESTION';

            const session2 = manager.getOrCreateSession('game1');

            expect(session2).toBe(session1);
            expect(session2.status).toBe('QUESTION');
        });
    });

    describe('loadGameData', () => {
        it('debe cargar datos del juego desde la DB', async () => {
            const mockGame = {
                id: 1,
                avoid_winners: true,
                total_winners: 3,
                winners: 2,
                game_kind: 'questions'
            };

            const mockQuestions = [
                { id: 1, text: '¿Pregunta 1?', options: '["A","B","C"]', answer_idx: 0 },
                { id: 2, text: '¿Pregunta 2?', options: '["X","Y","Z"]', answer_idx: 1 }
            ];

            db.query
                .mockResolvedValueOnce({ rows: [mockGame] })
                .mockResolvedValueOnce({ rows: mockQuestions });

            const session = await manager.loadGameData(1);

            expect(session.gameSettings).toEqual({
                avoid_winners: true,
                total_winners: 3,
                winners: 2,
                game_kind: 'questions'
            });
            expect(session.questions).toHaveLength(2);
            expect(session.questions[0].t).toBe('¿Pregunta 1?');
            expect(session.questions[0].options).toEqual(['A', 'B', 'C']);
        });

        it('debe lanzar error si el juego no existe', async () => {
            db.query.mockResolvedValueOnce({ rows: [] });

            await expect(manager.loadGameData(999)).rejects.toThrow('Juego con id 999 no encontrado');
        });

        it('debe retornar sesión existente si ya tiene preguntas cargadas', async () => {
            const session = manager.getOrCreateSession('game1');
            session.questions = [{ id: 1, t: 'Test', options: [], ans: 0 }];

            const result = await manager.loadGameData('game1');

            expect(result).toBe(session);
            expect(db.query).not.toHaveBeenCalled();
        });
    });

    describe('setStatus', () => {
        it('debe cambiar el estado de una sesión', () => {
            const session = manager.getOrCreateSession('game1');

            manager.setStatus('game1', 'QUESTION');

            expect(session.status).toBe('QUESTION');
        });
    });

    describe('getSession', () => {
        it('debe retornar null si la sesión no existe', () => {
            const session = manager.getSession('nonexistent');
            expect(session).toBeNull();
        });

        it('debe retornar la sesión si existe', () => {
            manager.getOrCreateSession('game1');
            const session = manager.getSession('game1');
            expect(session).toBeDefined();
        });
    });
});
