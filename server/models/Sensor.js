import mongoose from 'mongoose'

const sensorSchema = new mongoose.Schema(
  {
    sensorId: {
      type: String,
      required: [true, 'Sensor ID is required'],
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Sensor name is required'],
      trim: true,
    },
    type: {
      type: String,
      required: [true, 'Sensor type is required'],
      trim: true,
    },
    location: {
      type: String,
      required: [true, 'Location is required'],
      trim: true,
    },
    status: {
      type: String,
      default: 'Normal',
      trim: true,
    },
    health: {
      type: String,
      default: '100%',
      trim: true,
    },
    issue: {
      type: String,
      default: 'None · Standard operations',
      trim: true,
    },
    lastPing: {
      type: String,
      default: 'Just now',
      trim: true,
    },
    severity: {
      type: String,
      enum: ['Low', 'Medium', 'High', 'Critical'],
      default: 'Low',
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
        ret.id = ret.sensorId
        delete ret.__v
        return ret
      },
    },
  },
)

export const Sensor = mongoose.model('Sensor', sensorSchema)
