const mongoose = require('mongoose')
const { getActiveDriver } = require('../config/db')
const {
    SqliteCategoria,
    SqlitePostagem,
    SqliteUser,
    SqliteComentario
} = require('../config/sqlite')

// Garante o carregamento dos schemas do Mongoose para quando o MongoDB estiver ativo
require('./Categoria')
require('./Postagem')
require('./User')
require('./Comentario')

function getMongooseModel(name) {
    try {
        return mongoose.model(name)
    } catch (e) {
        return null
    }
}

function createModelProxy(mongooseModelName, SqliteClass) {
    function ModelConstructor(data = {}) {
        if (getActiveDriver() === 'mongodb') {
            const MongoModel = getMongooseModel(mongooseModelName)
            if (MongoModel) {
                return new MongoModel(data)
            }
        }
        return new SqliteClass(data)
    }

    // Encaminha métodos estáticos
    const staticMethods = [
        'find',
        'findOne',
        'findById',
        'findByIdAndUpdate',
        'findByIdAndDelete',
        'countDocuments',
        'deleteMany',
        'createIndexes'
    ]

    for (const method of staticMethods) {
        ModelConstructor[method] = function (...args) {
            if (getActiveDriver() === 'mongodb') {
                const MongoModel = getMongooseModel(mongooseModelName)
                if (MongoModel && typeof MongoModel[method] === 'function') {
                    return MongoModel[method](...args)
                }
            }
            if (typeof SqliteClass[method] === 'function') {
                return SqliteClass[method](...args)
            }
            return Promise.resolve(null)
        }
    }

    return ModelConstructor
}

const Categoria = createModelProxy('categorias', SqliteCategoria)
const Postagem = createModelProxy('postagens', SqlitePostagem)
const User = createModelProxy('users', SqliteUser)
const Comentario = createModelProxy('comentarios', SqliteComentario)

module.exports = {
    Categoria,
    Postagem,
    User,
    Comentario
}
