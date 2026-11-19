
import { proto } from '../../WAProto/index.js'

export type InteractiveResponse = {
    type: 'list' | 'buttons' | 'native-flow' | 'template'
    id?: string | null
    text?: string | null
    name?: string | null
    params?: Record<string, unknown> | string
    raw: unknown
}

export function extractInteractiveResponse(
    message: proto.IMessage
): InteractiveResponse | undefined {
    const content = message

    if (content.listResponseMessage) {
        return {
            type: 'list',
            id: content.listResponseMessage.singleSelectReply?.selectedRowId,
            text: content.listResponseMessage.title,
            raw: content.listResponseMessage
        }
    }

    if (content.buttonsResponseMessage) {
        return {
            type: 'buttons',
            id: content.buttonsResponseMessage.selectedButtonId,
            text: content.buttonsResponseMessage.selectedDisplayText,
            raw: content.buttonsResponseMessage
        }
    }

    if (content.interactiveResponseMessage) {
        const response =
            content.interactiveResponseMessage.nativeFlowResponseMessage

        let params: Record<string, unknown> | string | undefined

        if (response?.paramsJson) {
            try {
                params = JSON.parse(response.paramsJson)
            } catch {
                params = response.paramsJson
            }
        }

        return {
            type: 'native-flow',
            name: response?.name,
            params,
            text: content.interactiveResponseMessage.body?.text,
            raw: content.interactiveResponseMessage
        }
    }

    if (content.templateButtonReplyMessage) {
        return {
            type: 'template',
            id: content.templateButtonReplyMessage.selectedId,
            text: content.templateButtonReplyMessage.selectedDisplayText,
            raw: content.templateButtonReplyMessage
        }
    }

    return undefined
}
