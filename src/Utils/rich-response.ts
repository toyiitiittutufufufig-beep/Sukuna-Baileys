import { proto } from '../../WAProto/index.js'

export type RichHtmlResponseOptions = {
  title: string
  html: string
  responseId?: string
  tabTitle?: string
  url: string
  trustedSources?: string[]
  botTitle?: string
}

function section(primitive: Record<string, unknown>) {
  return {
    __typename: 'GenAIUnifiedResponseSection',
    view_model: {
      __typename: 'GenAISingleLayoutViewModel',
      primitive
    }
  }
}

/**
 * Builds the Rich HTML payload used by the supplied game examples.
 * This is a raw protocol payload, not a standard WhatsApp message type.
 */
export function buildRichHtmlResponse(options: RichHtmlResponseOptions) {
  if (!options.html?.trim()) {
    throw new Error('Rich HTML payload cannot be empty')
  }

  if (!options.url?.trim()) {
    throw new Error('A trusted source URL is required')
  }

  const host = new URL(options.url).hostname
  const trustedSources = options.trustedSources ?? [host]

  return {
    response_id: options.responseId ?? `Sukuna_${Date.now()}`,
    sections: [
      section({
        __typename: 'GenAIBotProgressStatusPrimitive',
        title: options.botTitle ?? options.title,
        is_in_progress: true
      })
    ],
    embedded_screens: [
      {
        title: options.title,
        content: [
          {
            __typename: 'FOAIDNixelButtonSheets',
            tabs: [
              {
                id: 'tab_0',
                tab_header: options.tabTitle ?? 'لعبة',
                sections: [
                  section({
                    __typename: 'GenAIaeacdsnwHtmlPrimitive',
                    payload: options.html,
                    url: options.url,
                    trusted_sources: trustedSources
                  })
                ],
                step_entries: []
              }
            ]
          }
        ]
      }
    ]
  }
}

/**
 * Creates the relay payload matching the supplied working examples.
 */
export function buildRichHtmlMessage(options: RichHtmlResponseOptions) {
  const unifiedResponse = buildRichHtmlResponse(options)

  return {
    messageContextInfo: {
      deviceListMetadata: {},
      deviceListMetadataVersion: 2,
      botMetadata: {
        messageDisclaimerText: '',
        richResponseSourcesMetadata: {}
      }
    },
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          messageType: 1,
          unifiedResponse: {
            data: Buffer.from(
              JSON.stringify(unifiedResponse),
              'utf8'
            ).toString('base64')
          },
          contextInfo: {
            forwardingScore: 1,
            isForwarded: true,
            forwardedAiBotMessageInfo: {
              botJid: '0@bot'
            },
            forwardOrigin: 4
          }
        }
      }
    }
  } as unknown as proto.IMessage
}