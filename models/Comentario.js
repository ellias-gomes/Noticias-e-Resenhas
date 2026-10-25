const mongoose = require('mongoose')
const Schema = mongoose.Schema

const ComentarioSchema = new Schema({
    usuario: {
        type: String,
        required: true
    },
    userId: {
        type: String,
        required: true
    },
    postagem: {
        type: String,
        required: true
    },
    comentario: {
        type: String,
        required: true
    },
    date: {
        type: Date,
        default: Date.now
    }
})

if (!mongoose.models.comentarios) {
    mongoose.model('comentarios', ComentarioSchema)
}

module.exports = ComentarioSchema
