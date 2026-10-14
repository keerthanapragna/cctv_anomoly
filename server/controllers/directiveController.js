import { Directive } from '../models/Directive.js'
import { Incident } from '../models/Incident.js'
import { successResponse, errorResponse } from '../utils/apiResponse.js'
import { ROLES } from '../config/constants.js'

export async function listDirectives(req, res, next) {
  try {
    const directives = await Directive.find()
      .populate('issuedBy', 'name role department')
      .sort({ createdAt: -1 })

    return successResponse(res, {
      message: 'Directives retrieved successfully.',
      data: {
        directives,
        total: directives.length,
      },
    })
  } catch (err) {
    next(err)
  }
}

export async function createDirective(req, res, next) {
  try {
    const { incidentId, directiveType, instructions } = req.body

    if (!incidentId || !directiveType || !instructions) {
      return errorResponse(res, {
        statusCode: 400,
        message: 'incidentId, directiveType, and instructions are required.',
      })
    }

    const issuedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

    const directive = await Directive.create({
      incidentId: incidentId.trim().toUpperCase(),
      directiveType: directiveType.trim(),
      instructions: instructions.trim(),
      issuedAt,
      issuedBy: req.user._id,
      issuer: req.user.name,
    })

    // Also append to the target incident's notes if incident exists
    const query = incidentId.startsWith('INC-')
      ? { incidentId: incidentId.toUpperCase() }
      : { _id: incidentId }

    const incident = await Incident.findOne(query)
    if (incident) {
      const directiveNote = `[Directive: ${directiveType} - "${instructions}" (Issued by ${req.user.name} at ${issuedAt})]`
      incident.notes = incident.notes ? `${incident.notes} ${directiveNote}` : directiveNote
      await incident.save()
    }

    return successResponse(res, {
      statusCode: 201,
      message: 'Executive directive issued successfully.',
      data: { directive, incident },
    })
  } catch (err) {
    next(err)
  }
}
