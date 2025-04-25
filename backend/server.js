const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const PORT = 3000;
const upload = multer();
const server = http.createServer(app);

// Создаем WebSocket-сервер, привязанный к тому же HTTP-серверу
const wss = new WebSocket.Server({ server });
const clients = new Set();

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

app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());
app.use(express.json());  

const uploadsFolder = path.join(__dirname, 'uploads');
app.use('/uploads', express.static(uploadsFolder));

const generateAccessToken = (user, secret) => {
  return jwt.sign({ id: user.id, login: user.login }, secret, { expiresIn: '15m' });
};

const generateRefreshToken = (user, secret) => {
  return jwt.sign({ id: user.id, username: user.login }, secret, { expiresIn: '7d' });
};


app.use((req, res, next) => {
  console.log('Получен запрос:', req.method, req.url);
  next();
});
  


app.post('/register', upload.none(), (req, res) => {
  const { login, password } = req.body;

  if (!password) {
    return res.status(400).send("Пароль обязателен");
  }

  // Проверяем, есть ли пользователь с таким username в базе данных
  db.get('SELECT login FROM users WHERE login = ?', [login], async (err, row) => {
    if (err) {
      return res.status(500).json({ message: 'Ошибка проверки пользователя' });
    }

    if (row) {
      return res.status(409).json({ message: 'Пользователь с таким именем уже существует' });
    }

    // Хешируем пароль перед сохранением
    const hashedPassword = await bcrypt.hash(password, 10);

    // Создаем нового пользователя
    db.run('INSERT INTO users (login, password) VALUES (?, ?)', [login, hashedPassword], function (err) {
      if (err) {
        return res.status(500).json({ message: err.message });
      }

      // Генерация уникальных секретов для пользователя
      const accessTokenSecret = jwt.sign({ userId: this.lastID }, 'access_secret', { expiresIn: '7d' });
      const refreshTokenSecret = jwt.sign({ userId: this.lastID }, 'refresh_secret', { expiresIn: '30d' });

      // Сохранение секретов в таблице user_secrets
      db.run(
        'INSERT INTO user_secrets (user_id, access_token_secret, refresh_token_secret) VALUES (?, ?, ?)',
        [this.lastID, accessTokenSecret, refreshTokenSecret],
        (err) => {
          if (err) {
            return res.status(500).json({ message: 'Ошибка сохранения секретов' });
          }

          // Генерация токенов на основе сгенерированных секретов
          const accessToken = jwt.sign({ id: this.lastID, login }, accessTokenSecret, { expiresIn: '15m' });
          const refreshToken = jwt.sign({ id: this.lastID, login }, refreshTokenSecret, { expiresIn: '7d' });

          // Сохранение данных пользователя в таблице aboutUsers
          db.run(
            'INSERT INTO aboutUsers (id , login) VALUES (?, ?)',
            [this.lastID, login],
            (err) => {
              if (err) {
                return res.status(500).json({ message: 'Ошибка сохранения данных пользователя' });
              }

              // Создаем папку для пользователя
              const userFolder = path.join(uploadsFolder, `user_${this.lastID}`);
              fs.mkdir(userFolder, { recursive: true }, (err) => {
                if (err) {
                  console.error('Ошибка создания папки пользователя:', err.message);
                  return res.status(500).json({ message: 'Ошибка создания папки пользователя' });
                }

              // Отправляем токены пользователю
              res.json({ userid: this.lastID, token: accessToken, refresh_token: refreshToken });
              })
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
  
  // Проверяем пользователя
  db.get('SELECT * FROM users WHERE login = ?', [login], async (err, user) => {
    if (err) {
      return res.status(500).json({ message: err.message });
    }
    if (!user) {
      return res.status(403).json({ message: 'Invalid login' });
    }

    // Проверяем пароль
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(403).json({ message: 'Invalid password' });
    }

    // Получаем секреты из базы данных
    db.get('SELECT * FROM user_secrets WHERE user_id = ?', [user.id], async (err, secrets) => {
      if (err) {
        return res.status(500).json({ message: 'Error fetching secrets' });
      }
      if (!secrets) {
        return res.status(500).json({ message: 'User secrets not found' });
      }

      // Проверка срока действия секретов (если они истекли)
      const currentTime = Math.floor(Date.now() / 1000); // Время в секундах
      const accessTokenSecretExpired = currentTime > jwt.decode(secrets.access_token_secret).exp;
      const refreshTokenSecretExpired = currentTime > jwt.decode(secrets.refresh_token_secret).exp;

      if (accessTokenSecretExpired || refreshTokenSecretExpired) {
        // Генерация новых секретов
        const newAccessTokenSecret = jwt.sign({ userId: user.id }, 'access_secret', { expiresIn: '7d' });
        const newRefreshTokenSecret = jwt.sign({ userId: user.id }, 'refresh_secret', { expiresIn: '30d' });

        // Обновляем секреты в базе данных
        db.run(
          'UPDATE user_secrets SET access_token_secret = ?, refresh_token_secret = ? WHERE user_id = ?',
          [newAccessTokenSecret, newRefreshTokenSecret, user.id],
          (err) => {
            if (err) {
              return res.status(500).json({ message: 'Error updating secrets' });
            }

            // Генерация новых токенов с новыми секретами
            const newAccessToken = generateAccessToken(user, newAccessTokenSecret);
            const newRefreshToken = generateRefreshToken(user, newRefreshTokenSecret);

            return res.json({ token: newAccessToken, refresh_token: newRefreshToken });
          }
        );
      } else {
        // Если секреты не истекли, создаем токены на основе текущих секретов
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

  // Извлекаем userId из токена без верификации
  const decoded = jwt.decode(refresh_token);
  if (!decoded || !decoded.id) {
      return res.status(403).json({ message: 'Невалидный токен refresh' });
  }

  const user = decoded;

  // Получаем секреты из базы данных
  db.get('SELECT * FROM user_secrets WHERE user_id = ?', [user.id], (err, secrets) => {
    if (err) {
      return res.status(500).json({ message: 'Error fetching secrets' });
    }

    const accessToken = generateAccessToken(user, secrets.access_token_secret);
    res.json({ userid: user.id, token: accessToken, refresh_token: refresh_token });
  });
});


app.get('/account/:id', authenticateToken, (req, res) => {
  const param = req.params.id

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
})


app.patch('/account/update_image', authenticateToken, (req, res) => {
  console.log('hello');
  
  // Конфигурация Multer для текущего запроса
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
  }).single('image'); // Принимаем только один файл с полем 'image'
  // Обработка загрузки файла
  upload(req, res, (err) => {
    if (err) {
      console.error('Ошибка загрузки файла:', err.message);
      return res.status(400).json({ message: 'Ошибка загрузки файла', error: err.message });
    }

    const userId = req.userId;
    if (!userId || !req.file) {
      return res.status(400).json({ message: 'Некорректный запрос или файл не загружен.' });
    }

    // Формируем относительный путь к файлу
    const fileUrl = `/uploads/user_${userId}/${req.file.filename}`;
    console.log(fileUrl);
    

    // Обновляем путь к файлу в базе данных
    const query = `
      UPDATE aboutUsers
      SET avatarUrl = ?
      WHERE userId = ?
    `;
    db.run(query, [fileUrl, userId], function (err) {
      if (err) {
        console.error('Ошибка обновления БД:', err.message);
        return res.status(500).json({ message: 'Ошибка обновления данных в БД' });
      }
      console.log('res');
      
      res.status(200).json({
        message: 'Аватар успешно загружен!',
        avatarUrl: fileUrl,
      });
    });
  });
});



app.patch('/account/update', authenticateToken, (req, res) => {
  const { username, description, city } = req.body;
  const userId = req.userId;
  

  if (!username || !description || !city) {
    return res.status(400).json({ message: 'Все поля (username, description, city) обязательны' });
  }

  // Обновляем данные в таблице aboutUsers
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


// Роут для поиска городов
app.patch('/account/cities', (req, res) => {
  const { city } = req.body
  

  if(city.length < 1) {
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
})




// Маршрут для получения данных переписки и информации о другом пользователе
app.get('/chats', authenticateToken, (req, res) => {
  const userId = req.userId;

  // Объединенный SQL-запрос
  const query = `
      SELECT 
          cu1.conversation_id AS conversationId,
          cu2.user_id AS otherUserId,
          au.username AS username,
          au.avatarUrl AS avatarUrl,
          msg.content AS lastMessage,
          COALESCE(msg.sent_at, c.created_at) AS lastMessageTime
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
      
      res.json(rows);
  });
});



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
          // Чат уже существует
          return res.json({ conversationId: row.conversationId });
      } else {
          // Чат не существует
          return res.json({ conversationId: 0 });
      }
  });
});



// Маршрут для удаления чата по conversationId
app.delete('/chats/:conversationId', authenticateToken, (req, res) => {
  const { conversationId } = req.params;
  const userId = req.userId; // ID пользователя, извлечённый из токена

  if (!conversationId) {
    return res.status(400).json({ error: 'Не указан conversationId' });
  }

  // Проверяем, принадлежит ли чат пользователю
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


      // Удаляем сам чат
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
      return res.status(500).json({ message: 'Ошибка сервера', error: err.message });
    }

    if (!rows.length) {
      return res.status(404).json({ message: 'Сообщения не найдены' });
    }

    // Преобразование данных
    const response = rows.map((row) => {
      const fileName = row.fileUrl ? row.fileUrl.split('/').pop() : null;
      const fileExpansion = fileName ? fileName.split('.').pop() : null;

      return {
        messageId: row.messageId,
        senderId: row.senderId,
        content: row.content,
        sentAt: row.sentAt,
        isRead: row.isRead,
        file: {
          fileName: fileName,
          fileUrl: row.fileUrl,
          fileExpansion: fileExpansion
        },
      };
    });

    res.json(response);
  });
});




// Маршрут для поиска пользователей по username
app.patch('/search-users', authenticateToken, (req, res) => {
  const { username } = req.body;
  const userId = req.userId;   // Получаем userId из middleware
  

  if (!username || username.trim() === '') {
    return res.status(400).json({ error: 'Параметр query обязателен' });
  }

  // SQL-запрос для поиска пользователей с совпадением по username
  const searchQuery = `
    SELECT id, username, avatarUrl 
    FROM aboutUsers 
    WHERE username LIKE ? AND id != ? 
    LIMIT 50
  `;
  const queryParam = `%${username.trim()}%`; // Добавляем % для частичного поиска

  db.all(searchQuery, [queryParam, userId], (err, rows) => {
    if (err) {
      console.error('Ошибка выполнения поиска:', err.message);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
    // Возвращаем найденных пользователей
    res.json(rows);
  });
});



// Middleware для проверки токена
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
      return res.status(403).json({ message: 'Токен отсутствует' });
  }

  // Извлекаем userId из токена без верификации
  const decoded = jwt.decode(token);
  if (!decoded || !decoded.id) {
      return res.status(403).json({ message: 'Невалидный токен' });
  }

  
  const userId = decoded.id;

  // Получаем секрет из базы данных
  db.get('SELECT access_token_secret FROM user_secrets WHERE user_id = ?', [userId], (err, row) => {
      if (err || !row) {
          return res.status(403).json({ message: 'Не удалось получить секрет' });
      }

      const accessSecret = row.access_token_secret;
      

      // Проверяем токен с найденным секретом
      jwt.verify(token, accessSecret, (err, user) => {
          if (err) {
              return res.status(403).json({ message: 'Недействительный токен' });
          }
          req.userId = user.id; // Сохраняем userId из токена
          next();
      });
  });
}



wss.on('connection', (ws) => {
  console.log('Новое подключение');
  clients.add(ws);
  

  // Приветственное сообщение
  ws.send(JSON.stringify({ message: 'Добро пожаловать в чат!' }));

  ws.on('message', (message) => {
    try {
        const data = JSON.parse(message);
        if (data.type === 'newMessage') {
            handleNewMessage(data, ws);
        } else if (data.type === 'newChat') {
            handleNewChat(data, ws);
        } else if(data.type === 'fileMessage'){
          handleFileUpload(data)
        } else if (data.type === 'authenticate' && data.token ) {
          authenticateTokenWebSocket(data.token, (error, userId) => {
            console.log(userId)
            if (error) {
              console.log(error);
              ws.close(); // Закрываем соединение, если токен некорректен
            } else {
              ws.userId = userId; // Присваиваем userId подключенному WebSocket
              clients.add(ws); // Добавляем клиента в список активных
              console.log(`Подключен пользователь с ID: ${userId}`);
            }
          })
        }
    } catch (err) {
        console.error('Ошибка обработки сообщения WebSocket:', err.message);
    }
  });

  ws.on('close', () => {
      console.log('Клиент WebSocket отключился');
  });




  // Функция: Обработка нового сообщения
  function handleNewMessage(data, ws) {
    if (!data.conversationId || !data.senderId || !data.content) {
        ws.send(JSON.stringify({ error: 'Неверный формат сообщения' }));
        return;
    }
    
    const query = `
        INSERT INTO messages (conversation_id, sender_id, content, sent_at)
        VALUES (?, ?, ?, datetime('now', 'localtime'))
    `;
    const params = [data.conversationId, data.senderId, data.content];

    db.run(query, params, function (err) {
        if (err) {
            console.error('Ошибка записи сообщения:', err.message);
            ws.send(JSON.stringify({ error: 'Не удалось сохранить сообщение' }));
        } else {
            const response = {
                type: 'newMessage',
                messageId: this.lastID,
                conversationId: data.conversationId,
                senderId: data.senderId,
                content: data.content,
                sentAt: new Date().toISOString()
            };

            // Получаем список пользователей, которые участвуют в переписке
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

                // Рассылаем сообщение только участникам переписки
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


function handleNewChat(data, ws) {
  if (!data.userIds || data.userIds.length < 2) {
    ws.send(JSON.stringify({ error: 'Неверный формат чата или сообщения' }));
    return;
  }

  // Создаем новый чат
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

      // Добавляем пользователей в чат
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
            // Запускаем запросы на получение данных только после добавления всех пользователей
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

                // Формируем объект для конкретного пользователя
                const response = {
                  type: 'newChat',
                  conversationId,
                  otherUserId: row.otherUserId,
                  username: row.username,
                  avatarUrl: row.avatarUrl,
                  lastMessageTime: row.chatCreatedAt
                };

                // Отправляем ответ только этому пользователю
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




// Функция обработки файлов
function handleFileUpload(data, ws) {
  const { conversationId, senderId, fileName, fileContent } = data;

  if (!conversationId || !senderId || !fileName || !fileContent) {
    ws.send(JSON.stringify({ error: 'Неверный формат данных' }));
    return;
  }

  // Формируем название папки в формате user_<ID>
  const userFolderName = `user_${senderId}`;
  const userFolderPath = path.join(uploadsFolder, userFolderName);

  // Проверяем, существует ли папка, если нет — создаем
    if (!fs.existsSync(userFolderPath)) {
        fs.mkdirSync(userFolderPath, { recursive: true });
    }

  const filePath = path.join(userFolderPath, fileName);

  // Сохраняем файл
  fs.writeFile(filePath, Buffer.from(fileContent, 'base64'), (err) => {
    if (err) {
      console.error('Ошибка сохранения файла:', err.message);
      ws.send(JSON.stringify({ error: 'Ошибка сохранения файла' }));
      return;
    }

    console.log(`Файл сохранен: ${filePath}`);

    // Сохраняем ссылку на файл в базе данных
    const query = `
      INSERT INTO messages (conversation_id, sender_id, file, sent_at)
      VALUES (?, ?, ?, datetime('now', 'localtime'))
    `;
    db.run(query, [conversationId, senderId, `user_${senderId}/${fileName}`], function (err) {
      if (err) {
        console.error('Ошибка сохранения ссылки на файл в базу:', err.message);
        ws.send(JSON.stringify({ error: 'Ошибка сохранения данных файла в базу' }));
        return;
      }
  
      // Здесь мы получаем последний вставленный идентификатор
      const messageId = this.lastID;
      const fileExpansion = fileName ? fileName.split('.').pop() : null;
  
      const response = {
        type: 'newMessage',
        messageId: messageId, // Используем полученный идентификатор
        conversationId: data.conversationId,
        senderId: data.senderId,
        content: '',
        sentAt: new Date().toISOString(),
        file: {
          fileName: fileName,
          fileUrl: `user_${senderId}/${fileName}`,
          fileExpansion: fileExpansion
        }
      };
  
      // Получаем список пользователей, которые участвуют в переписке
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
  
        // Рассылаем сообщение только участникам переписки
        users.forEach((user) => {
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN && client.userId === user.user_id) {
              client.send(JSON.stringify(response));
              console.log(response);
            }
          });
        });
      });
    });
  });
}




  function authenticateTokenWebSocket(token, callback) {
    if (!token) {
      return callback('Токен отсутствует', null); // Если токен отсутствует
    }
  
    // Декодируем токен, чтобы извлечь userId
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.id) {
      return callback('Невалидный токен', null); // Если токен некорректный или не содержит id
    }
  
    const userId = decoded.id;
  
    // Получаем секрет из базы данных для этого пользователя
    db.get('SELECT access_token_secret FROM user_secrets WHERE user_id = ?', [userId], (err, row) => {
      if (err || !row) {
        return callback('Не удалось получить секрет', null); // Ошибка при получении секрета
      }
  
      const accessSecret = row.access_token_secret;
      
      
  
      // Проверяем токен с найденным секретом
      jwt.verify(token, accessSecret, (err, user) => {
        if (err) {
          return callback('Недействительный токен', null); // Ошибка валидации токена
        }
        callback(null, user.id); // Если токен действителен, возвращаем userId
      });
    });
  }




  // Обработка ошибок
  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
});





  // Запуск сервера
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
