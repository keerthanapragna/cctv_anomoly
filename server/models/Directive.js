import mongoose from 'mongoose'

const directiveSchema = new mongoose.Schema(
  {
    incidentId: {
      type: String,
      required: [true, 'Target incident ID is required'],
      trim: true,
      index: true,
    },
    directiveType: {
      type: String,
      required: [true, 'Directive type is required'],
      trim: true,
    },
    instructions: {
      type: String,
      required: [true, 'Instructions are required'],
      trim: true,
    },
    issuedAt: {
      type: String,
      default: () =>
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
    issuedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Issuing user is required'],
    },
    issuer: {
      type: String,
      required: [true, 'Issuer name is required'],
      trim: true,
    },
    isSample: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        ret.id = ret._id
        delete ret.__v
        return ret
      },
    },
  },
)

export const Directive = mongoose.model('Directive', directiveSchema)
