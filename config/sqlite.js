require('dotenv').config()
const sqlite3 = require('sqlite3').verbose()
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

const SQLITE_FILE = process.env.SQLITE_PATH
    ? path.resolve(process.env.SQLITE_PATH)
    : path.join(__dirname, '..', 'data', 'noticias.sqlite')

const DATA_DIR = path.dirname(SQLITE_FILE)
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
}

let dbInstance = null

function getDb() {
    if (!dbInstance) {
        dbInstance = new sqlite3.Database(SQLITE_FILE)
    }
    return dbInstance
}

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        getDb().run(sql, params, function (err) {
            if (err) reject(err)
            else resolve(this)
        })
    })
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        getDb().get(sql, params, (err, row) => {
            if (err) reject(err)
            else resolve(row || null)
        })
    })
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        getDb().all(sql, params, (err, rows) => {
            if (err) reject(err)
            else resolve(rows || [])
        })
    })
}

function generateId() {
    return crypto.randomBytes(12).toString('hex')
}

async function ensureColumn(table, column, definition) {
    try {
        const cols = await all(`PRAGMA table_info(${table})`)
        const exists = cols.some((c) => c.name === column)
        if (!exists) {
            await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
        }
    } catch (e) {
        // Ignora se já existir
    }
}

// Inicializa tabelas SQLite e migra novas colunas automaticamente
async function initSqlite() {
    await run(`
        CREATE TABLE IF NOT EXISTS categorias (
            _id TEXT PRIMARY KEY,
            nome TEXT NOT NULL,
            slug TEXT NOT NULL UNIQUE,
            date TEXT NOT NULL
        )
    `)

    await run(`
        CREATE TABLE IF NOT EXISTS postagens (
            _id TEXT PRIMARY KEY,
            titulo TEXT NOT NULL,
            slug TEXT NOT NULL UNIQUE,
            descricao TEXT NOT NULL,
            conteudo TEXT NOT NULL,
            fonte TEXT NOT NULL,
            autor TEXT DEFAULT 'Redação',
            categoria TEXT NOT NULL,
            img TEXT DEFAULT '',
            carousel INTEGER DEFAULT 0,
            views INTEGER DEFAULT 0,
            likes INTEGER DEFAULT 0,
            likedBy TEXT DEFAULT '[]',
            date TEXT NOT NULL
        )
    `)

    // Migração suave para bancos SQLite já criados anteriormente
    await ensureColumn('postagens', 'autor', "TEXT DEFAULT 'Redação'")
    await ensureColumn('postagens', 'views', 'INTEGER DEFAULT 0')
    await ensureColumn('postagens', 'likes', 'INTEGER DEFAULT 0')
    await ensureColumn('postagens', 'likedBy', "TEXT DEFAULT '[]'")

    await run(`
        CREATE TABLE IF NOT EXISTS users (
            _id TEXT PRIMARY KEY,
            nome TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            Admin INTEGER DEFAULT 0,
            senha TEXT NOT NULL,
            avatar TEXT DEFAULT '',
            confirm INTEGER DEFAULT 0,
            resetPasswordToken TEXT DEFAULT NULL,
            resetPasswordExpires TEXT DEFAULT NULL,
            data TEXT NOT NULL
        )
    `)

    await run(`
        CREATE TABLE IF NOT EXISTS comentarios (
            _id TEXT PRIMARY KEY,
            usuario TEXT NOT NULL,
            userId TEXT NOT NULL,
            postagem TEXT NOT NULL,
            comentario TEXT NOT NULL,
            date TEXT NOT NULL
        )
    `)
}

function parseLikedBy(raw) {
    if (Array.isArray(raw)) return raw.map(String)
    if (!raw) return []
    try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.map(String) : []
    } catch (e) {
        return []
    }
}

// Normaliza objetos retornados do SQLite
function normalizeCategoria(row) {
    if (!row) return null
    return {
        _id: String(row._id),
        nome: row.nome,
        slug: row.slug,
        date: new Date(row.date)
    }
}

function normalizePostagem(row, categoriaObj = null) {
    if (!row) return null
    const likedBy = parseLikedBy(row.likedBy)
    return {
        _id: String(row._id),
        titulo: row.titulo,
        slug: row.slug,
        descricao: row.descricao,
        conteudo: row.conteudo,
        fonte: row.fonte,
        autor: row.autor || 'Redação',
        categoria: categoriaObj || String(row.categoria),
        img: row.img || '',
        carousel: Boolean(row.carousel),
        views: Number(row.views || 0),
        likes: Number(row.likes || likedBy.length || 0),
        likedBy: likedBy,
        date: new Date(row.date)
    }
}

function normalizeUser(row) {
    if (!row) return null
    return {
        _id: String(row._id),
        nome: row.nome,
        email: row.email,
        Admin: Boolean(row.Admin),
        senha: row.senha,
        avatar: row.avatar || '',
        confirm: Boolean(row.confirm),
        resetPasswordToken: row.resetPasswordToken || null,
        resetPasswordExpires: row.resetPasswordExpires ? new Date(row.resetPasswordExpires) : null,
        data: new Date(row.data)
    }
}

function normalizeComentario(row) {
    if (!row) return null
    return {
        _id: String(row._id),
        usuario: row.usuario,
        userId: String(row.userId),
        postagem: String(row.postagem),
        comentario: row.comentario,
        date: new Date(row.date)
    }
}

// -------------------------------------------------------------
// Model SQLite: Categoria
// -------------------------------------------------------------
class SqliteCategoria {
    constructor(data = {}) {
        this._id = data._id ? String(data._id) : generateId()
        this.nome = data.nome || ''
        this.slug = data.slug || ''
        this.date = data.date ? new Date(data.date) : new Date()
    }

    async save() {
        const existing = await get('SELECT _id FROM categorias WHERE _id = ?', [this._id])
        if (existing) {
            await run(
                'UPDATE categorias SET nome = ?, slug = ?, date = ? WHERE _id = ?',
                [this.nome, this.slug, this.date.toISOString(), this._id]
            )
        } else {
            await run(
                'INSERT INTO categorias (_id, nome, slug, date) VALUES (?, ?, ?, ?)',
                [this._id, this.nome, this.slug, this.date.toISOString()]
            )
        }
        return this
    }

    static find(filter = {}) {
        let sortClause = 'ORDER BY date DESC'
        const executor = async () => {
            let sql = 'SELECT * FROM categorias'
            const params = []
            if (filter && filter._id) {
                sql += ' WHERE _id = ?'
                params.push(String(filter._id))
            }
            sql += ` ${sortClause}`
            const rows = await all(sql, params)
            return rows.map(normalizeCategoria)
        }

        const queryObj = {
            sort(criteria) {
                if (criteria && (criteria.date === 'asc' || criteria.date === 1)) {
                    sortClause = 'ORDER BY date ASC'
                } else {
                    sortClause = 'ORDER BY date DESC'
                }
                return queryObj
            },
            lean() {
                return queryObj
            },
            populate() {
                return queryObj
            },
            then(resolve, reject) {
                return executor().then(resolve, reject)
            },
            catch(reject) {
                return executor().catch(reject)
            }
        }
        return queryObj
    }

    static findOne(filter = {}) {
        let isLean = false
        const executor = async () => {
            let row = null
            if (filter.slug) {
                row = await get('SELECT * FROM categorias WHERE slug = ?', [filter.slug])
            } else if (filter._id) {
                row = await get('SELECT * FROM categorias WHERE _id = ?', [String(filter._id)])
            } else {
                row = await get('SELECT * FROM categorias LIMIT 1')
            }
            if (!row) return null
            if (isLean) return normalizeCategoria(row)
            const cat = new SqliteCategoria(row)
            cat.lean = () => Promise.resolve(normalizeCategoria(row))
            return cat
        }

        const queryObj = {
            lean() {
                isLean = true
                return queryObj
            },
            populate() {
                return queryObj
            },
            then(resolve, reject) {
                return executor().then(resolve, reject)
            },
            catch(reject) {
                return executor().catch(reject)
            }
        }
        return queryObj
    }

    static findById(id) {
        let isLean = false
        const executor = async () => {
            const row = await get('SELECT * FROM categorias WHERE _id = ?', [String(id)])
            if (!row) return null
            if (isLean) {
                return normalizeCategoria(row)
            }
            const cat = new SqliteCategoria(row)
            cat.lean = () => Promise.resolve(normalizeCategoria(row))
            return cat
        }

        const queryObj = {
            lean() {
                isLean = true
                return queryObj
            },
            populate() {
                return queryObj
            },
            then(resolve, reject) {
                return executor().then(resolve, reject)
            },
            catch(reject) {
                return executor().catch(reject)
            }
        }
        return queryObj
    }

    static async findByIdAndDelete(id) {
        return run('DELETE FROM categorias WHERE _id = ?', [String(id)])
    }

    static async countDocuments() {
        const res = await get('SELECT COUNT(*) AS total FROM categorias')
        return res ? Number(res.total) : 0
    }
}

// -------------------------------------------------------------
// Model SQLite: Postagem
// -------------------------------------------------------------
class SqlitePostagem {
    constructor(data = {}) {
        this._id = data._id ? String(data._id) : generateId()
        this.titulo = data.titulo || ''
        this.slug = data.slug || ''
        this.descricao = data.descricao || ''
        this.conteudo = data.conteudo || ''
        this.fonte = data.fonte || ''
        this.autor = data.autor || 'Redação'
        this.categoria = data.categoria ? String(data.categoria._id || data.categoria) : ''
        this.img = data.img || ''
        this.carousel = Boolean(data.carousel)
        this.views = Number(data.views || 0)
        this.likedBy = parseLikedBy(data.likedBy)
        this.likes = Number(data.likes !== undefined ? data.likes : this.likedBy.length)
        this.date = data.date ? new Date(data.date) : new Date()
    }

    async save() {
        const existing = await get('SELECT _id FROM postagens WHERE _id = ?', [this._id])
        const carouselInt = this.carousel ? 1 : 0
        const dateIso = this.date instanceof Date ? this.date.toISOString() : new Date(this.date).toISOString()
        const likedByJson = JSON.stringify(Array.isArray(this.likedBy) ? this.likedBy : [])
        const likesCount = Number(this.likes || 0)
        const viewsCount = Number(this.views || 0)

        if (existing) {
            await run(
                `UPDATE postagens SET
                    titulo = ?, slug = ?, descricao = ?, conteudo = ?, fonte = ?, autor = ?,
                    categoria = ?, img = ?, carousel = ?, views = ?, likes = ?, likedBy = ?, date = ?
                 WHERE _id = ?`,
                [
                    this.titulo,
                    this.slug,
                    this.descricao,
                    this.conteudo,
                    this.fonte,
                    this.autor,
                    this.categoria,
                    this.img,
                    carouselInt,
                    viewsCount,
                    likesCount,
                    likedByJson,
                    dateIso,
                    this._id
                ]
            )
        } else {
            await run(
                `INSERT INTO postagens (
                    _id, titulo, slug, descricao, conteudo, fonte, autor, categoria, img, carousel, views, likes, likedBy, date
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    this._id,
                    this.titulo,
                    this.slug,
                    this.descricao,
                    this.conteudo,
                    this.fonte,
                    this.autor,
                    this.categoria,
                    this.img,
                    carouselInt,
                    viewsCount,
                    likesCount,
                    likedByJson,
                    dateIso
                ]
            )
        }
        return this
    }

    static find(filter = {}) {
        let shouldPopulate = false
        let sortClause = 'ORDER BY p.date DESC'

        const executor = async () => {
            let sql = `
                SELECT p.*,
                       c._id AS c_id, c.nome AS c_nome, c.slug AS c_slug, c.date AS c_date
                FROM postagens p
                LEFT JOIN categorias c ON p.categoria = c._id
            `
            const conditions = []
            const params = []

            if (filter.categoria) {
                conditions.push('p.categoria = ?')
                params.push(String(filter.categoria))
            }

            if (filter.likedBy) {
                conditions.push('p.likedBy LIKE ?')
                params.push(`%"${String(filter.likedBy)}"%`)
            }

            if (filter.$or && Array.isArray(filter.$or)) {
                const orClauses = []
                for (const condition of filter.$or) {
                    if (condition.titulo && condition.titulo.$regex) {
                        const regexStr = condition.titulo.$regex.source || String(condition.titulo.$regex)
                        const cleaned = regexStr.replace(/\\/g, '')
                        orClauses.push('p.titulo LIKE ?')
                        params.push(`%${cleaned}%`)
                    }
                    if (condition.descricao && condition.descricao.$regex) {
                        const regexStr = condition.descricao.$regex.source || String(condition.descricao.$regex)
                        const cleaned = regexStr.replace(/\\/g, '')
                        orClauses.push('p.descricao LIKE ?')
                        params.push(`%${cleaned}%`)
                    }
                }
                if (orClauses.length > 0) {
                    conditions.push(`(${orClauses.join(' OR ')})`)
                }
            }

            if (conditions.length > 0) {
                sql += ` WHERE ${conditions.join(' AND ')}`
            }

            sql += ` ${sortClause}`
            const rows = await all(sql, params)

            return rows.map((row) => {
                const categoriaObj =
                    shouldPopulate && row.c_id
                        ? {
                              _id: String(row.c_id),
                              nome: row.c_nome,
                              slug: row.c_slug,
                              date: new Date(row.c_date)
                          }
                        : String(row.categoria)
                return normalizePostagem(row, categoriaObj)
            })
        }

        const queryObj = {
            populate() {
                shouldPopulate = true
                return queryObj
            },
            sort(criteria) {
                if (criteria && (criteria.views === 'desc' || criteria.views === -1)) {
                    sortClause = 'ORDER BY p.views DESC, p.date DESC'
                } else if (criteria && (criteria.likes === 'desc' || criteria.likes === -1)) {
                    sortClause = 'ORDER BY p.likes DESC, p.date DESC'
                } else if (criteria && (criteria.date === 'asc' || criteria.date === 1)) {
                    sortClause = 'ORDER BY p.date ASC'
                } else {
                    sortClause = 'ORDER BY p.date DESC'
                }
                return queryObj
            },
            lean() {
                return queryObj
            },
            then(resolve, reject) {
                return executor().then(resolve, reject)
            },
            catch(reject) {
                return executor().catch(reject)
            }
        }
        return queryObj
    }

    static findOne(filter = {}) {
        let shouldPopulate = false
        let isLean = false

        const executor = async () => {
            let sql = `
                SELECT p.*,
                       c._id AS c_id, c.nome AS c_nome, c.slug AS c_slug, c.date AS c_date
                FROM postagens p
                LEFT JOIN categorias c ON p.categoria = c._id
            `
            const conditions = []
            const params = []

            if (filter.slug) {
                conditions.push('p.slug = ?')
                params.push(filter.slug)
            }
            if (filter._id) {
                conditions.push('p._id = ?')
                params.push(String(filter._id))
            }

            if (conditions.length > 0) {
                sql += ` WHERE ${conditions.join(' AND ')}`
            }
            sql += ' LIMIT 1'

            const row = await get(sql, params)
            if (!row) return null

            const categoriaObj =
                shouldPopulate && row.c_id
                    ? {
                          _id: String(row.c_id),
                          nome: row.c_nome,
                          slug: row.c_slug,
                          date: new Date(row.c_date)
                      }
                    : String(row.categoria)

            if (isLean) {
                return normalizePostagem(row, categoriaObj)
            }
            const post = new SqlitePostagem(row)
            if (shouldPopulate && row.c_id) {
                post.categoria = categoriaObj
            }
            post.lean = () => Promise.resolve(normalizePostagem(row, categoriaObj))
            return post
        }

        const queryObj = {
            populate() {
                shouldPopulate = true
                return queryObj
            },
            lean() {
                isLean = true
                return queryObj
            },
            then(resolve, reject) {
                return executor().then(resolve, reject)
            },
            catch(reject) {
                return executor().catch(reject)
            }
        }
        return queryObj
    }

    static findById(id) {
        let isLean = false
        let shouldPopulate = false

        const executor = async () => {
            let sql = `
                SELECT p.*,
                       c._id AS c_id, c.nome AS c_nome, c.slug AS c_slug, c.date AS c_date
                FROM postagens p
                LEFT JOIN categorias c ON p.categoria = c._id
                WHERE p._id = ?
                LIMIT 1
            `
            const row = await get(sql, [String(id)])
            if (!row) return null

            const categoriaObj =
                shouldPopulate && row.c_id
                    ? {
                          _id: String(row.c_id),
                          nome: row.c_nome,
                          slug: row.c_slug,
                          date: new Date(row.c_date)
                      }
                    : String(row.categoria)

            if (isLean) {
                return normalizePostagem(row, categoriaObj)
            }
            const post = new SqlitePostagem(row)
            post.lean = () => Promise.resolve(normalizePostagem(row, categoriaObj))
            return post
        }

        const queryObj = {
            lean() {
                isLean = true
                return queryObj
            },
            populate() {
                shouldPopulate = true
                return queryObj
            },
            then(resolve, reject) {
                return executor().then(resolve, reject)
            },
            catch(reject) {
                return executor().catch(reject)
            }
        }
        return queryObj
    }

    static async findByIdAndDelete(id) {
        const post = await get('SELECT * FROM postagens WHERE _id = ?', [String(id)])
        await run('DELETE FROM postagens WHERE _id = ?', [String(id)])
        return post ? normalizePostagem(post) : null
    }

    static async countDocuments() {
        const res = await get('SELECT COUNT(*) AS total FROM postagens')
        return res ? Number(res.total) : 0
    }

    static async createIndexes() {
        return Promise.resolve()
    }
}

// -------------------------------------------------------------
// Model SQLite: User
// -------------------------------------------------------------
class SqliteUser {
    constructor(data = {}) {
        this._id = data._id ? String(data._id) : generateId()
        this.nome = data.nome || ''
        this.email = (data.email || '').toLowerCase().trim()
        this.Admin = Boolean(data.Admin)
        this.senha = data.senha || ''
        this.avatar = data.avatar || ''
        this.confirm = Boolean(data.confirm)
        this.resetPasswordToken = data.resetPasswordToken || null
        this.resetPasswordExpires = data.resetPasswordExpires ? new Date(data.resetPasswordExpires) : null
        this.data = data.data ? new Date(data.data) : new Date()
    }

    async save() {
        const existing = await get('SELECT _id FROM users WHERE _id = ?', [this._id])
        const adminInt = this.Admin ? 1 : 0
        const confirmInt = this.confirm ? 1 : 0
        const resetExpStr = this.resetPasswordExpires ? this.resetPasswordExpires.toISOString() : null
        const dataIso = this.data instanceof Date ? this.data.toISOString() : new Date(this.data).toISOString()

        if (existing) {
            await run(
                `UPDATE users SET
                    nome = ?, email = ?, Admin = ?, senha = ?, avatar = ?,
                    confirm = ?, resetPasswordToken = ?, resetPasswordExpires = ?, data = ?
                 WHERE _id = ?`,
                [
                    this.nome,
                    this.email,
                    adminInt,
                    this.senha,
                    this.avatar,
                    confirmInt,
                    this.resetPasswordToken,
                    resetExpStr,
                    dataIso,
                    this._id
                ]
            )
        } else {
            await run(
                `INSERT INTO users (
                    _id, nome, email, Admin, senha, avatar, confirm, resetPasswordToken, resetPasswordExpires, data
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    this._id,
                    this.nome,
                    this.email,
                    adminInt,
                    this.senha,
                    this.avatar,
                    confirmInt,
                    this.resetPasswordToken,
                    resetExpStr,
                    dataIso
                ]
            )
        }
        return this
    }

    static find() {
        let sortClause = 'ORDER BY data DESC'
        const executor = async () => {
            const rows = await all(`SELECT * FROM users ${sortClause}`)
            return rows.map(normalizeUser)
        }

        const queryObj = {
            sort(criteria) {
                if (criteria && (criteria.data === 'asc' || criteria.data === 1)) {
                    sortClause = 'ORDER BY data ASC'
                } else {
                    sortClause = 'ORDER BY data DESC'
                }
                return queryObj
            },
            lean() {
                return queryObj
            },
            populate() {
                return queryObj
            },
            then(resolve, reject) {
                return executor().then(resolve, reject)
            },
            catch(reject) {
                return executor().catch(reject)
            }
        }
        return queryObj
    }

    static findOne(filter = {}) {
        let isLean = false
        const executor = async () => {
            let row = null
            if (filter.email) {
                row = await get('SELECT * FROM users WHERE email = ?', [filter.email.toLowerCase().trim()])
            } else if (filter.resetPasswordToken) {
                row = await get('SELECT * FROM users WHERE resetPasswordToken = ?', [filter.resetPasswordToken])
                if (row && filter.resetPasswordExpires && filter.resetPasswordExpires.$gt) {
                    const expires = row.resetPasswordExpires ? new Date(row.resetPasswordExpires).getTime() : 0
                    if (expires < Date.now()) row = null
                }
            } else if (filter._id) {
                row = await get('SELECT * FROM users WHERE _id = ?', [String(filter._id)])
            } else {
                row = await get('SELECT * FROM users LIMIT 1')
            }

            if (!row) return null
            if (isLean) return normalizeUser(row)
            const user = new SqliteUser(row)
            user.lean = () => Promise.resolve(normalizeUser(row))
            return user
        }

        const queryObj = {
            lean() {
                isLean = true
                return queryObj
            },
            populate() {
                return queryObj
            },
            then(resolve, reject) {
                return executor().then(resolve, reject)
            },
            catch(reject) {
                return executor().catch(reject)
            }
        }
        return queryObj
    }

    static findById(id) {
        let isLean = false
        const executor = async () => {
            const row = await get('SELECT * FROM users WHERE _id = ?', [String(id)])
            if (!row) return null
            if (isLean) {
                return normalizeUser(row)
            }
            const user = new SqliteUser(row)
            user.lean = () => Promise.resolve(normalizeUser(row))
            return user
        }

        const queryObj = {
            lean() {
                isLean = true
                return queryObj
            },
            populate() {
                return queryObj
            },
            then(resolve, reject) {
                return executor().then(resolve, reject)
            },
            catch(reject) {
                return executor().catch(reject)
            }
        }
        return queryObj
    }

    static async findByIdAndUpdate(id, updateData) {
        const user = await SqliteUser.findById(id)
        if (!user) return null
        if (updateData.confirm !== undefined) user.confirm = Boolean(updateData.confirm)
        if (updateData.avatar !== undefined) user.avatar = updateData.avatar
        if (updateData.Admin !== undefined) user.Admin = Boolean(updateData.Admin)
        if (updateData.nome !== undefined) user.nome = updateData.nome
        await user.save()
        return user
    }

    static async findByIdAndDelete(id) {
        return run('DELETE FROM users WHERE _id = ?', [String(id)])
    }

    static async countDocuments() {
        const res = await get('SELECT COUNT(*) AS total FROM users')
        return res ? Number(res.total) : 0
    }
}

// -------------------------------------------------------------
// Model SQLite: Comentario
// -------------------------------------------------------------
class SqliteComentario {
    constructor(data = {}) {
        this._id = data._id ? String(data._id) : generateId()
        this.usuario = data.usuario || ''
        this.userId = String(data.userId || '')
        this.postagem = String(data.postagem || '')
        this.comentario = data.comentario || ''
        this.date = data.date ? new Date(data.date) : new Date()
    }

    async save() {
        await run(
            `INSERT INTO comentarios (_id, usuario, userId, postagem, comentario, date)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [this._id, this.usuario, this.userId, this.postagem, this.comentario, this.date.toISOString()]
        )
        return this
    }

    static find(filter = {}) {
        const executor = async () => {
            let sql = 'SELECT * FROM comentarios'
            const params = []
            if (filter.postagem) {
                sql += ' WHERE postagem = ?'
                params.push(String(filter.postagem))
            } else if (filter.userId) {
                sql += ' WHERE userId = ?'
                params.push(String(filter.userId))
            }
            sql += ' ORDER BY date DESC'
            const rows = await all(sql, params)
            return rows.map(normalizeComentario)
        }

        const queryObj = {
            sort() {
                return queryObj
            },
            populate() {
                return queryObj
            },
            lean() {
                return queryObj
            },
            then(resolve, reject) {
                return executor().then(resolve, reject)
            },
            catch(reject) {
                return executor().catch(reject)
            }
        }
        return queryObj
    }

    static findById(id) {
        let isLean = false
        const executor = async () => {
            const row = await get('SELECT * FROM comentarios WHERE _id = ?', [String(id)])
            if (!row) return null
            if (isLean) return normalizeComentario(row)
            return new SqliteComentario(row)
        }
        const queryObj = {
            lean() {
                isLean = true
                return queryObj
            },
            then(resolve, reject) {
                return executor().then(resolve, reject)
            },
            catch(reject) {
                return executor().catch(reject)
            }
        }
        return queryObj
    }

    static async findByIdAndDelete(id) {
        return run('DELETE FROM comentarios WHERE _id = ?', [String(id)])
    }

    static async deleteMany(filter = {}) {
        if (filter.postagem) {
            return run('DELETE FROM comentarios WHERE postagem = ?', [String(filter.postagem)])
        }
        return run('DELETE FROM comentarios')
    }

    static async countDocuments() {
        const res = await get('SELECT COUNT(*) AS total FROM comentarios')
        return res ? Number(res.total) : 0
    }
}

module.exports = {
    initSqlite,
    SqliteCategoria,
    SqlitePostagem,
    SqliteUser,
    SqliteComentario,
    SQLITE_FILE
}
