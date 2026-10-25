require('dotenv').config()
const mongoose = require('mongoose')
const { initSqlite, SQLITE_FILE } = require('./sqlite')

const mongoURI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/noticias'
let activeDriver = 'sqlite' // Padrão seguro inicial

/**
 * Inicializa a conexão com o banco de dados com fallback automático para SQLite
 */
async function initDatabase() {
    const dbClient = (process.env.DB_CLIENT || 'auto').toLowerCase()

    if (dbClient === 'sqlite') {
        await initSqlite()
        activeDriver = 'sqlite'
        console.log(`[Banco de Dados] Modo SQLite ativado diretamente (${SQLITE_FILE})`)
        return 'sqlite'
    }

    // Tenta conectar ao MongoDB com timeout rápido (2 segundos)
    try {
        mongoose.Promise = global.Promise
        await mongoose.connect(mongoURI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            useCreateIndex: true,
            useFindAndModify: false,
            serverSelectionTimeoutMS: 2000,
            connectTimeoutMS: 2000
        })

        activeDriver = 'mongodb'
        console.log('[Banco de Dados] MongoDB conectado com sucesso!')
        return 'mongodb'
    } catch (err) {
        console.log('[Banco de Dados] MongoDB indisponível (' + err.message + ').')
        console.log(`[Banco de Dados] Ativando fallback automático para SQLite (${SQLITE_FILE})...`)
        await initSqlite()
        activeDriver = 'sqlite'
        console.log('[Banco de Dados] SQLite conectado e pronto para uso!')
        return 'sqlite'
    }
}

function getActiveDriver() {
    if (activeDriver === 'mongodb' && mongoose.connection.readyState === 1) {
        return 'mongodb'
    }
    return 'sqlite'
}

module.exports = {
    mongoURI,
    initDatabase,
    getActiveDriver,
    isUsingMongo: () => getActiveDriver() === 'mongodb',
    isUsingSqlite: () => getActiveDriver() === 'sqlite'
}
