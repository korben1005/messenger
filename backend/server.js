const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const WebSocket = require('ws');
const ffmpeg = require('fluent-ffmpeg'); // Добавляем импорт

const app = express();
const PORT = 3000;
const upload = multer();

// Подключение к базе данных SQLite
const db = new sqlite3.Database('./messenger.db', (err) => {
    if (err) console.error('Ошибка подключения к БД:', err.message);
    else {
        console.log('Подключено к SQLite');
        db.run('PRAGMA foreign_keys = ON', (err) => {
            if (err) {
                console.error('Ошибка включения внешних ключей:', err.message);
            }
        });
    }
});

// Чтение сертификата и ключа
const options = {
    key: fs.readFileSync('certs/server.key'),
    cert: fs.readFileSync('certs/server.cert')
};

// Создание HTTPS-сервера
const server = https.createServer(options, app);

// Создаем WebSocket-сервер, привязанный к HTTPS-серверу
const wss = new WebSocket.Server({ server });
const clients = new Set();

// Настройка middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const uploadsFolder = path.join(__dirname, 'Uploads');
app.use('/uploads', express.static(uploadsFolder));

// Логирование запросов
app.use((req, res, next) => {
    console.log('Получен запрос:', req.method, req.url);
    next();
});

// Временное хранилище для фрагментов
const fileChunks = new Map();

// Очистка старых фрагментов каждые 5 минут
setInterval(() => {
    const now = Date.now();
    for (const [key] of fileChunks) {
        const [userId, conversationId, fileName] = key.split('-');
        if (userId && conversationId && fileName && now - (fileChunks.get(key).timestamp || 0) > 5 * 60 * 1000) { // 5 минут
            fileChunks.delete(key);
        }
    }
}, 5 * 60 * 1000);

// Функции для генерации токенов
const generateAccessToken = (user, secret) => {
    return jwt.sign({ id: user.id, login: user.login }, secret, { expiresIn: '15m' });
};

const generateRefreshToken = (user, secret) => {
    return jwt.sign({ id: user.id, username: user.login }, secret, { expiresIn: '7d' });
};

// Функция для извлечения длительности с помощью MediaInfo
        const getDuration = (fileUrl) => {
            return new Promise((resolve) => {
                if (!fileUrl) {
                    resolve(null);
                    return;
                }
                const filePath = path.join(uploadsFolder, fileUrl.replace('/uploads/', ''));
                if (!fs.existsSync(filePath)) {
                    console.log('File not found on disk:', filePath);
                    resolve(null);
                    return;
                }

                // Вызываем MediaInfo через командную строку
                const mediaInfoPath = path.join(__dirname, 'MediaInfo_CLI_25.04_Windows_x64', 'MediaInfo.exe');
                const command = `"${mediaInfoPath}" --Inform="General;%Duration%" "${filePath}"`;
                execPromise(command)
                    .then(({ stdout }) => {
                        const durationMs = parseInt(stdout.trim(), 10); // Длительность в миллисекундах
                        const duration = durationMs ? durationMs / 1000 : null; // Переводим в секунды
                        console.log('Extracted duration:', { filePath, duration });
                        resolve(duration);
                    })
                    .catch((err) => {
                        console.error('Ошибка извлечения метаданных для:', filePath, err);
                        resolve(null);
                    });
            });
        };

// Регистрация пользователя
app.post('/register', upload.none(), (req, res) => {
    const { login, password } = req.body;

    if (!password) {
        return res.status(400).send("Пароль обязателен");
    }

    db.get('SELECT login FROM users WHERE login = ?', [login], async (err, row) => {
        if (err) {
            return res.status(500).json({ message: 'Ошибка проверки пользователя' });
        }

        if (row) {
            return res.status(409).json({ message: 'Пользователь с таким именем уже существует' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        db.run('INSERT INTO users (login, password) VALUES (?, ?)', [login, hashedPassword], function (err) {
            if (err) {
                return res.status(500).json({ message: err.message });
            }

            const accessTokenSecret = jwt.sign({ userId: this.lastID }, 'access_secret', { expiresIn: '7d' });
            const refreshTokenSecret = jwt.sign({ userId: this.lastID }, 'refresh_secret', { expiresIn: '30d' });

            db.run(
                'INSERT INTO user_secrets (user_id, access_token_secret, refresh_token_secret) VALUES (?, ?, ?)',
                [this.lastID, accessTokenSecret, refreshTokenSecret],
                (err) => {
                    if (err) {
                        return res.status(500).json({ message: 'Ошибка сохранения секретов' });
                    }

                    const accessToken = jwt.sign({ id: this.lastID, login }, accessTokenSecret, { expiresIn: '15m' });
                    const refreshToken = jwt.sign({ id: this.lastID, login }, refreshTokenSecret, { expiresIn: '7d' });

                    db.run(
                        'INSERT INTO aboutUsers (id, login) VALUES (?, ?)',
                        [this.lastID, login],
                        (err) => {
                            if (err) {
                                return res.status(500).json({ message: 'Ошибка сохранения данных пользователя' });
                            }

                            const userFolder = path.join(uploadsFolder, `user_${this.lastID}`);
                            fs.mkdir(userFolder, { recursive: true }, (err) => {
                                if (err) {
                                    console.error('Ошибка создания папки пользователя:', err.message);
                                    return res.status(500).json({ message: 'Ошибка создания папки пользователя' });
                                }

                                res.json({ userid: this.lastID, token: accessToken, refresh_token: refreshToken });
                            });
                        }
                    );
                }
            );
        });
    });
});

// Аутентификация
app.post('/token', upload.none(), (req, res) => {
    const { login, password } = req.body;

    db.get('SELECT * FROM users WHERE login = ?', [login], async (err, user) => {
        if (err) {
            return res.status(500).json({ message: err.message });
        }
        if (!user) {
            return res.status(403).json({ message: 'Invalid login' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(403).json({ message: 'Invalid password' });
        }

        db.get('SELECT * FROM user_secrets WHERE user_id = ?', [user.id], async (err, secrets) => {
            if (err) {
                return res.status(500).json({ message: 'Error fetching secrets' });
            }
            if (!secrets) {
                return res.status(500).json({ message: 'User secrets not found' });
            }

            const currentTime = Math.floor(Date.now() / 1000);
            const accessTokenSecretExpired = currentTime > jwt.decode(secrets.access_token_secret).exp;
            const refreshTokenSecretExpired = currentTime > jwt.decode(secrets.refresh_token_secret).exp;

            if (accessTokenSecretExpired || refreshTokenSecretExpired) {
                const newAccessTokenSecret = jwt.sign({ userId: user.id }, 'access_secret', { expiresIn: '7d' });
                const newRefreshTokenSecret = jwt.sign({ userId: user.id }, 'refresh_secret', { expiresIn: '30d' });

                db.run(
                    'UPDATE user_secrets SET access_token_secret = ?, refresh_token_secret = ? WHERE user_id = ?',
                    [newAccessTokenSecret, newRefreshTokenSecret, user.id],
                    (err) => {
                        if (err) {
                            return res.status(500).json({ message: 'Error updating secrets' });
                        }

                        const newAccessToken = generateAccessToken(user, newAccessTokenSecret);
                        const newRefreshToken = generateRefreshToken(user, newRefreshTokenSecret);

                        return res.json({ token: newAccessToken, refresh_token: newRefreshToken });
                    }
                );
            } else {
                const accessToken = generateAccessToken(user, secrets.access_token_secret);
                const refreshToken = generateRefreshToken(user, secrets.refresh_token_secret);

                return res.json({ userid: user.id, token: accessToken, refresh_token: refreshToken });
            }
        });
    });
});

// Обновление токена
app.post('/refresh', (req, res) => {
    const { refresh_token } = req.body;

    if (!refresh_token) {
        return res.status(403).json({ message: 'Refresh token required' });
    }

    const decoded = jwt.decode(refresh_token);
    if (!decoded || !decoded.id) {
        return res.status(403).json({ message: 'Невалидный токен refresh' });
    }

    const user = decoded;

    db.get('SELECT * FROM user_secrets WHERE user_id = ?', [user.id], (err, secrets) => {
        if (err) {
            return res.status(500).json({ message: 'Error fetching secrets' });
        }

        const accessToken = generateAccessToken(user, secrets.access_token_secret);
        res.json({ userid: user.id, token: accessToken, refresh_token: refresh_token });
    });
});

// Получение данных аккаунта
app.get('/account/:id', authenticateToken, (req, res) => {
    const param = req.params.id;
    const userId = param === 'me' ? req.userId : parseInt(param, 10);

    db.get('SELECT id, login, username, description, avatarUrl, isActive, city FROM aboutUsers WHERE id = ?', [userId], (err, row) => {
        if (err) {
            console.error('Ошибка выполнения запроса:', err.message);
            return res.status(500).json({ message: 'Ошибка сервера' });
        }

        if (!row) {
            return res.status(404).json({ message: 'Пользователь не найден' });
        }

        res.json(row);
    });
});

// Обновление аватара
app.patch('/account/update_image', authenticateToken, (req, res) => {
    const upload = multer({
        storage: multer.diskStorage({
            destination: (req, file, cb) => {
                const userId = req.userId;
                if (!userId) {
                    return cb(new Error('userId отсутствует'), null);
                }

                const userFolderPath = path.join(uploadsFolder, `user_${userId}`);
                fs.mkdirSync(userFolderPath, { recursive: true });
                cb(null, userFolderPath);
            },
            filename: (req, file, cb) => {
                const fileExt = path.extname(file.originalname);
                cb(null, `avatar${fileExt}`);
            },
        }),
    }).single('image');

    upload(req, res, (err) => {
        if (err) {
            console.error('Ошибка загрузки файла:', err.message);
            return res.status(400).json({ message: 'Ошибка загрузки файла', error: err.message });
        }

        const userId = req.userId;
        if (!userId || !req.file) {
            return res.status(400).json({ message: 'Некорректный запрос или файл не загружен.' });
        }

        const fileUrl = `/uploads/user_${userId}/${req.file.filename}`;

        const query = `
            UPDATE aboutUsers
            SET avatarUrl = ?
            WHERE id = ?
        `;
        db.run(query, [fileUrl, userId], function (err) {
            if (err) {
                console.error('Ошибка обновления БД:', err.message);
                return res.status(500).json({ message: 'Ошибка обновления данных в БД' });
            }

            res.status(200).json({
                message: 'Аватар успешно загружен!',
                avatarUrl: fileUrl,
            });
        });
    });
});

// Обновление данных профиля
app.patch('/account/update', authenticateToken, (req, res) => {
    const { username, description, city } = req.body;
    const userId = req.userId;

    if (!username || !description || !city) {
        return res.status(400).json({ message: 'Все поля (username, description, city) обязательны' });
    }

    const query = `
        UPDATE aboutUsers
        SET username = ?, description = ?, city = ?
        WHERE id = ?
    `;

    db.run(query, [username, description, city, userId], function (err) {
        if (err) {
            return res.status(500).json({ message: 'Ошибка при обновлении данных', error: err.message });
        }

        if (this.changes === 0) {
            return res.status(404).json({ message: 'Пользователь не найден' });
        }

        res.json({ message: 'Данные успешно обновлены' });
    });
});

// Поиск городов
app.patch('/account/cities', (req, res) => {
    const { city } = req.body;

    if (city.length < 1) {
        return res.status(400).json({ error: 'Запрос должен содержать хотя бы один символ' });
    }

    const sql = `SELECT * FROM cities WHERE city LIKE ? LIMIT 50`;
    const queryParam = `%${city.trim()}%`;

    db.all(sql, [queryParam], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка базы данных' });
        }

        res.json(rows);
    });
});

// Получение списка чатов
app.get('/chats', authenticateToken, (req, res) => {
    const userId = req.userId;

    const query = `
       SELECT 
            cu1.conversation_id AS conversationId,
            cu2.user_id AS otherUserId,
            au.username AS username,
            au.avatarUrl AS avatarUrl,
            msg.content AS lastMessage,
            COALESCE(msg.sent_at, c.created_at) AS lastMessageTime,
            COALESCE(unread.unreadCount, 0) AS unreadCount
        FROM conversation_users cu1
        JOIN conversation_users cu2 
            ON cu1.conversation_id = cu2.conversation_id AND cu2.user_id != cu1.user_id
        JOIN aboutUsers au
            ON cu2.user_id = au.id
        LEFT JOIN messages msg
            ON cu1.conversation_id = msg.conversation_id 
            AND msg.sent_at = (
                SELECT MAX(sent_at) 
                FROM messages 
                WHERE conversation_id = cu1.conversation_id
            )
        LEFT JOIN (
            SELECT conversation_id, sender_id, COUNT(*) as unreadCount
            FROM messages
            WHERE is_read = 0
            GROUP BY conversation_id, sender_id
        ) unread
            ON cu1.conversation_id = unread.conversation_id AND cu2.user_id = unread.sender_id
        JOIN conversations c
            ON cu1.conversation_id = c.id
        WHERE cu1.user_id = ?;
    `;

    db.all(query, [userId], (err, rows) => {
        if (err) {
            return res.status(500).json({ message: 'Ошибка сервера', error: err.message });
        }

        if (!rows.length) {
            return res.status(404).json({ message: 'Переписки не найдены' });
        }
        console.log(rows)

        res.json(rows);
    });
});

// Проверка существования чата
app.post('/chats/checkExistence', authenticateToken, (req, res) => {
    const userId = req.userId;
    const { otherUserId } = req.body;

    if (!otherUserId) {
        return res.status(400).json({ message: 'ID другого пользователя обязателен' });
    }

    const checkQuery = `
        SELECT cu1.conversation_id AS conversationId
        FROM conversation_users cu1
        JOIN conversation_users cu2 
            ON cu1.conversation_id = cu2.conversation_id
        WHERE cu1.user_id = ? AND cu2.user_id = ?;
    `;

    db.get(checkQuery, [userId, otherUserId], (err, row) => {
        if (err) {
            return res.status(500).json({ message: 'Ошибка сервера', error: err.message });
        }

        if (row) {
            return res.json({ conversationId: row.conversationId });
        } else {
            return res.json({ conversationId: 0 });
        }
    });
});

// Удаление чата
app.delete('/chats/:conversationId', authenticateToken, (req, res) => {
    const { conversationId } = req.params;
    const userId = req.userId;

    if (!conversationId) {
        return res.status(400).json({ error: 'Не указан conversationId' });
    }

    const checkQuery = `
        SELECT 1 
        FROM conversation_users 
        WHERE conversation_id = ? AND user_id = ?
    `;

    db.get(checkQuery, [conversationId, userId], (err, row) => {
        if (err) {
            console.error('Ошибка проверки чата:', err.message);
            return res.status(500).json({ error: 'Ошибка сервера' });
        }

        if (!row) {
            return res.status(403).json({ error: 'У вас нет доступа к этому чату' });
        }

        const deleteChatQuery = `
            DELETE FROM conversations 
            WHERE id = ?
        `;

        db.run(deleteChatQuery, [conversationId], (err) => {
            if (err) {
                console.error('Ошибка удаления чата:', err.message);
                return res.status(500).json({ error: 'Не удалось удалить чат' });
            }

            res.json({ success: true, message: 'Чат успешно удалён' });
        });
    });
});

const { exec } = require('child_process');
const util = require('util');
const { rejects } = require('assert');
const execPromise = util.promisify(exec);

app.get('/chats/:conversationId/messages', authenticateToken, (req, res) => {
    const conversationId = req.params.conversationId;
    const userId = req.userId;

    const query = `
        SELECT 
            m.id AS messageId,
            m.sender_id AS senderId,
            m.content AS content,
            m.sent_at AS sentAt,
            m.is_read AS isRead,
            m.file AS fileUrl
        FROM messages m
        JOIN conversation_users cu ON cu.conversation_id = m.conversation_id
        WHERE m.conversation_id = ? AND cu.user_id = ?
        ORDER BY m.sent_at ASC;
    `;

    db.all(query, [conversationId, userId], (err, rows) => {
        if (err) {
            console.error('Ошибка получения сообщений:', err);
            return res.status(500).json({ message: 'Ошибка сервера', error: err.message });
        }

        if (!rows.length) {
            return res.status(404).json({ message: 'Сообщения не найдены' });
        }

        // Асинхронно извлекаем длительности для всех файлов
        const processRows = async () => {
            const response = await Promise.all(rows.map(async (row) => {
                const fileName = row.fileUrl ? row.fileUrl.split('/').pop() : null;
                const fileExpansion = fileName ? fileName.split('.').pop() : null;
                let duration = 1;

                if (row.fileUrl && (row.fileUrl.endsWith('.mp4') || row.fileUrl.endsWith('.webm') || row.fileUrl.endsWith('.ogg'))) {
                    duration = await getDuration(row.fileUrl);
                }

                duration = Math.floor(duration)

                return {
                    messageId: row.messageId,
                    senderId: row.senderId,
                    content: row.content,
                    sentAt: row.sentAt,
                    isRead: row.isRead,
                    file: {
                        fileName: fileName,
                        fileUrl: row.fileUrl,
                        fileExpansion: fileExpansion,
                        duration: duration
                    },
                };
            }));

            res.json(response);
        };

        processRows().catch((err) => {
            console.error('Ошибка обработки сообщений:', err);
            res.status(500).json({ message: 'Ошибка обработки сообщений' });
        });
    });
});

app.get('/files', authenticateToken, (req, res) =>{
    const userId = req.userId;
    const userFolderPath = path.join(uploadsFolder, `user_${userId}`);

    if (!fs.existsSync(userFolderPath)) {
        return res.status(404).json({ error: 'User folder not found' });
    }

    fs.readdir(userFolderPath, (err, files) => {
    if (err) {
      console.error('Error reading directory:', err);
      return res.status(500).json({ error: 'Error reading files' });
    }

    // Фильтруем только файлы (игнорируем папки)
    const fileNames = files.filter(file => fs.statSync(path.join(userFolderPath, file)).isFile());
    const updatedFileNames = fileNames.map(file => `user_${userId}/${file}`);

    // Отправляем список названий файлов
    res.json(updatedFileNames);
  });
    
})

// Поиск пользователей
app.patch('/search-users', authenticateToken, (req, res) => {
    const { username } = req.body;
    const userId = req.userId;

    if (!username || username.trim() === '') {
        return res.status(400).json({ error: 'Параметр query обязателен' });
    }

    const searchQuery = `
        SELECT id, username, avatarUrl 
        FROM aboutUsers 
        WHERE username LIKE ? AND id != ? 
        LIMIT 50
    `;
    const queryParam = `%${username.trim()}%`;

    db.all(searchQuery, [queryParam, userId], (err, rows) => {
        if (err) {
            console.error('Ошибка выполнения поиска:', err.message);
            return res.status(500).json({ error: 'Ошибка сервера' });
        }
        res.json(rows);
    });
});

// GET /chats/:conversationId/check-chunks — проверка загруженных фрагментов с userId
app.get('/chats/:conversationId/check-chunks', authenticateToken, (req, res) => {
    const conversationId = parseInt(req.params.conversationId, 10);
    const userId = req.userId;
    const { fileName } = req.query;

    if (isNaN(conversationId) || !fileName || !userId) {
        return res.status(400).json({ message: 'Некорректные данные' });
    }

    const chunkKey = `${userId}-${conversationId}-${fileName}`;
    if (!fileChunks.has(chunkKey)) {
        return res.json({ uploadedChunks: [], userId });
    }

    const uploadedChunks = fileChunks.get(chunkKey)
        .map((chunk, index) => (chunk ? index : null))
        .filter(index => index !== null);

    res.json({ uploadedChunks });
    
});

// POST /chats/:conversationId/upload-chunk — отправка фрагментов с userId
app.post('/chats/:conversationId/upload-chunk', authenticateToken, upload.single('chunk'), (req, res) => {
    const conversationId = parseInt(req.params.conversationId, 10);
    const userId = req.userId;
    const { fileName, chunkIndex, totalChunks } = req.body;
    const chunk = req.file ? req.file.buffer : null;

    console.log('upload-chunk request:', { conversationId, userId, fileName, chunkIndex, totalChunks, chunk: chunk ? 'present' : 'null' });

    if (isNaN(conversationId) || !fileName || typeof chunkIndex === 'undefined' || !totalChunks || !chunk || !userId) {
        console.log('Bad request details:', { conversationId, userId, fileName, chunkIndex, totalChunks, chunk });
        return res.status(400).json({ message: 'Некорректные данные', details: { conversationId, userId, fileName, chunkIndex, totalChunks, chunk } });
    }

    const chunkKey = `${userId}-${conversationId}-${fileName}`;
    if (!fileChunks.has(chunkKey)) {
        fileChunks.set(chunkKey, new Array(parseInt(totalChunks)).fill(null));
    }

    const index = parseInt(chunkIndex);
    if (index >= fileChunks.get(chunkKey).length) {
        return res.status(400).json({ message: 'Некорректный индекс чанка' });
    }

    fileChunks.get(chunkKey)[index] = chunk;
    fileChunks.get(chunkKey).timestamp = Date.now();
    res.status(200).json({ message: 'Фрагмент получен', chunkIndex });
});

// POST /chats/:conversationId/complete-upload — завершение загрузки с userId
app.post('/chats/:conversationId/complete-upload', authenticateToken, (req, res) => {
    const conversationId = parseInt(req.params.conversationId, 10);
    const userId = req.userId;
    const { fileName, totalChunks } = req.body;
    console.log(fileName, totalChunks);
    

    if (isNaN(conversationId) || !fileName || !totalChunks || !userId) {
        return res.status(400).json({ message: 'Некорректные данные' });
    }

    const chunkKey = `${userId}-${conversationId}-${fileName}`;
    if (!fileChunks.has(chunkKey) || fileChunks.get(chunkKey).length !== totalChunks) {
        return res.status(400).json({ message: 'Не все фрагменты получены' });
    }

    const chunks = fileChunks.get(chunkKey);
    console.log('Chunks received:', chunks.map(c => c ? 'filled' : 'null'));
    
    const fullFileContent = Buffer.concat(chunks);
    
    fileChunks.delete(chunkKey); // Очищаем после сборки

    const userFolderPath = path.join(uploadsFolder, `user_${userId}`);
    if (!fs.existsSync(userFolderPath)) {
        fs.mkdirSync(userFolderPath, { recursive: true });
    }

    const filePath = path.join(userFolderPath, fileName);
    fs.writeFile(filePath, fullFileContent, (err) => {
        if (err) {
            return res.status(500).json({ message: 'Ошибка сохранения файла', error: err.message });
        }

        const fileUrl = `user_${userId}/${fileName}`;
        const fileExpansion = path.extname(fileName).slice(1);

        const query = `
            INSERT INTO messages (conversation_id, sender_id, file, sent_at)
            VALUES (?, ?, ?, datetime('now', 'localtime'))
        `;
        db.run(query, [conversationId, userId, fileUrl], function (err) {
            if (err) {
                return res.status(500).json({ message: 'Ошибка сохранения данных файла в базу' });
            }
            let duration = 1
            let response = {}

            const processRows = async () => {
                if(fileUrl.endsWith('.mp4') || fileUrl.endsWith('.webm') || fileUrl.endsWith('.ogg')) {
                    duration = await getDuration(fileUrl);
                }
                const messageId = this.lastID;
                response = {
                    type: 'newMessage',
                    messageId: messageId,
                    conversationId: conversationId,
                    senderId: userId,
                    content: '',
                    sentAt: new Date().toISOString(),
                    file: {
                        fileName: fileName,
                        fileUrl: fileUrl,
                        fileExpansion: fileExpansion,
                        duration: duration
                    }
                }
            }
            processRows()

            const usersQuery = `
                SELECT user_id
                FROM conversation_users
                WHERE conversation_id = ?
            `;
            db.all(usersQuery, [conversationId], (err, users) => {
                if (err) return;
                users.forEach((user) => {
                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN && client.userId === user.user_id) {
                            client.send(JSON.stringify(response));
                        }
                    });
                });
            });
        });
    });
});

// Middleware для проверки токена
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(403).json({ message: 'Токен отсутствует' });
    }

    const decoded = jwt.decode(token);
    if (!decoded || !decoded.id) {
        return res.status(403).json({ message: 'Невалидный токен' });
    }

    const userId = decoded.id;

    db.get('SELECT access_token_secret FROM user_secrets WHERE user_id = ?', [userId], (err, row) => {
        if (err || !row) {
            return res.status(403).json({ message: 'Не удалось получить секрет' });
        }

        const accessSecret = row.access_token_secret;

        jwt.verify(token, accessSecret, (err, user) => {
            if (err) {
                return res.status(403).json({ message: 'Недействительный токен' });
            }
            req.userId = user.id;
            next();
        });
    });
}

// WebSocket: обработка подключений
wss.on('connection', (ws) => {
    console.log('Новое подключение');
    clients.add(ws);

    ws.send(JSON.stringify({ message: 'Добро пожаловать в чат!' }));

    ws.on('message', (message) => {
    try {
        const data = JSON.parse(message);
        switch (data.type) {
            case 'newMessage':
                handleNewMessage(data, ws);
                break;
            case 'newChat':
                handleNewChat(data, ws);
                break;
            case 'fileMessage':
                handleFileUpload(data, ws);
                break;
            case 'readingChat':
                handleReadingChat(data, ws)
                break;
            case 'authenticate':
                if (data.token) {
                    authenticateTokenWebSocket(data.token, (error, userId) => {
                        if (error) {
                            console.log(error);
                            ws.close();
                        } else {
                            ws.userId = userId;
                            clients.add(ws);
                            console.log(`Подключен пользователь с ID: ${userId}`);
                        }
                    });
                }
                break;
            default:
                // Необязательно, но можно добавить обработку неизвестных типов
                console.log(`Неизвестный тип сообщения: ${data.type}`);
                break;
                }
        } catch (error) {
            console.error('Ошибка при парсинге сообщения:', error);
            ws.close();
        }
    });

    ws.on('close', () => {
        console.log('Клиент WebSocket отключился');
        clients.delete(ws);
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
    });
});

// Обработка нового сообщения
function handleNewMessage(data, ws) {
    if (!data.conversationId || !data.senderId) {
        ws.send(JSON.stringify({ error: 'Неверный формат сообщения' }));
        return;
    }

    let query = ''
    let params = []
    let duration = 0

    const duration1 = async (fileUrl) => {
            if(fileUrl.endsWith('.mp4') || fileUrl.endsWith('.webm') || fileUrl.endsWith('.ogg')) {
                duration = await getDuration(fileUrl);
            }
        }

    if(data.content) {
        query = `
            INSERT INTO messages (conversation_id, sender_id, content, sent_at)
            VALUES (?, ?, ?, datetime('now', 'localtime'))
        `;
        params = [data.conversationId, data.senderId, data.content];
    } else if(data.fileUrl) {
        duration1(data.fileUrl)
        query = `
            INSERT INTO messages (conversation_id, sender_id, file, sent_at)
            VALUES (?, ?, ?, datetime('now', 'localtime'))
        `;
        params = [data.conversationId, data.senderId, data.fileUrl];
    }

    db.run(query, params, function (err) {
        if (err) {
            console.error('Ошибка записи сообщения:', err.message);
            ws.send(JSON.stringify({ error: 'Не удалось сохранить сообщение' }));
        } else {
            let response = {}
            if(data.fileUrl) {
                response = {
                    type: 'newMessage',
                    messageId: this.lastID,
                    conversationId: data.conversationId,
                    senderId: data.senderId,
                    content: data.content,
                    sentAt: new Date().toISOString(),
                    isRead: 0,
                    file: {
                        fileName: data.fileUrl.split('/').pop(),
                        fileUrl: data.fileUrl,
                        fileExpansion: data.fileUrl.slice(data.fileUrl.lastIndexOf('.') + 1),
                        duration: duration
                    }
                };
            } else {
                response = {
                    type: 'newMessage',
                    messageId: this.lastID,
                    conversationId: data.conversationId,
                    senderId: data.senderId,
                    content: data.content,
                    sentAt: new Date().toISOString(),
                    isRead: 0
                }
            }

            console.log(response)

            const usersQuery = `
                SELECT user_id
                FROM conversation_users
                WHERE conversation_id = ?
            `;

            db.all(usersQuery, [data.conversationId], (err, users) => {
                if (err) {
                    console.error('Ошибка получения пользователей переписки:', err.message);
                    return;
                }

                users.forEach((user) => {
                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN && client.userId === user.user_id) {
                            client.send(JSON.stringify(response));
                        }
                    });
                });
            });
        }
    });
}

// Обработка нового чата
function handleNewChat(data, ws) {
    if (!data.userIds || data.userIds.length < 2) {
        ws.send(JSON.stringify({ error: 'Неверный формат чата или сообщения' }));
        return;
    }

    const query = `
        INSERT INTO conversations (type, created_at)
        VALUES ('private', datetime('now', 'localtime'))
    `;

    db.run(query, [], function (err) {
        if (err) {
            console.error('Ошибка создания чата:', err.message);
            ws.send(JSON.stringify({ error: 'Не удалось создать чат' }));
        } else {
            const conversationId = this.lastID;

            const userInsertQuery = `
                INSERT INTO conversation_users (conversation_id, user_id, last_read_at)
                VALUES (?, ?, datetime('now', 'localtime'))
            `;

            let insertCount = 0;

            data.userIds.forEach((userId) => {
                db.run(userInsertQuery, [conversationId, userId], function (err) {
                    if (err) {
                        console.error('Ошибка добавления пользователя в чат:', err.message);
                    }

                    insertCount++;
                    if (insertCount === data.userIds.length) {
                        const getChatDataQuery = `
                            SELECT 
                                cu.user_id AS otherUserId,
                                au.username,
                                au.avatarUrl,
                                c.created_at AS chatCreatedAt
                            FROM conversation_users cu
                            JOIN aboutUsers au ON cu.user_id = au.id
                            JOIN conversations c ON cu.conversation_id = c.id
                            WHERE cu.conversation_id = ? AND cu.user_id != ?
                        `;

                        data.userIds.forEach((userId) => {
                            db.get(getChatDataQuery, [conversationId, userId], (err, row) => {
                                if (err) {
                                    console.error('Ошибка получения данных чата:', err.message);
                                    return;
                                }

                                if (!row) {
                                    console.warn(
                                        `Данные для conversationId=${conversationId} и userId=${userId} не найдены.`
                                    );
                                    return;
                                }

                                const response = {
                                    type: 'newChat',
                                    conversationId,
                                    otherUserId: row.otherUserId,
                                    username: row.username,
                                    avatarUrl: row.avatarUrl,
                                    lastMessageTime: row.chatCreatedAt
                                };

                                wss.clients.forEach((client) => {
                                    if (
                                        client.readyState === WebSocket.OPEN &&
                                        client.userId === userId
                                    ) {
                                        client.send(JSON.stringify(response));
                                        console.log('Отправлено:', response);
                                    }
                                });
                            });
                        });
                    }
                });
            });
        }
    });
}

function handleReadingChat(data, ws) {
    if(!data.conversationId || !data.userId) {
        ws.send(JSON.stringify({ error: 'Неверный формат' }));
        return;
    }
    const currentUserId = data.userId;
    const conversationId = data.conversationId;

    const updateQuery = `
            UPDATE messages
            SET is_read = 1
            WHERE conversation_id = ?
            AND sender_id != ?
            AND is_read = 0;
        `;

    db.run(updateQuery, [conversationId, currentUserId], function (err) {
        if (err) {
            console.error('ошибка', err.message);
        }
        const response = {
            type: 'ReadingChat',
            conversationId: conversationId
        }

        const usersQuery = `
            SELECT user_id
            FROM conversation_users
            WHERE conversation_id = ?
        `;

        db.all(usersQuery, [conversationId], (err, users) => {
            if (err) {
                console.error('Ошибка получения пользователей переписки:', err.message);
                return;
            }

            users.forEach((user) => {
                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN && client.userId === user.user_id) {
                        client.send(JSON.stringify(response));
                    }
                });
            });
        });
    })
}

// Аутентификация WebSocket
function authenticateTokenWebSocket(token, callback) {
    if (!token) {
        return callback('Токен отсутствует', null);
    }

    const decoded = jwt.decode(token);
    if (!decoded || !decoded.id) {
        return callback('Невалидный токен', null);
    }

    const userId = decoded.id;

    db.get('SELECT access_token_secret FROM user_secrets WHERE user_id = ?', [userId], (err, row) => {
        if (err || !row) {
            return callback('Не удалось получить секрет', null);
        }

        const accessSecret = row.access_token_secret;

        jwt.verify(token, accessSecret, (err, user) => {
            if (err) {
                return callback('Недействительный токен', null);
            }
            callback(null, user.id);
        });
    });
}

// Запуск HTTPS-сервера
server.listen(PORT, () => {
    console.log(`HTTPS server running on https://localhost:${PORT}`);
});