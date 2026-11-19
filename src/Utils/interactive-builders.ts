
import { proto } from '../../WAProto/index.js'

type NativeFlowButton = {
    name: string
    buttonParamsJson: string
}

type NativeFlowOptions = {
    title?: string
    body: string
    footer?: string
    buttons: NativeFlowButton[]
    messageVersion?: number
}

type CarouselOptions = {
    cards: proto.Message.IInteractiveMessage[]
    messageVersion?: number
}

function validateButtons(buttons: NativeFlowButton[]) {
    if (!Array.isArray(buttons) || buttons.length === 0) {
        throw new Error('Native Flow requires at least one button')
    }

    for (const button of buttons) {
        if (!button.name || !button.buttonParamsJson) {
            throw new Error('Each button requires name and buttonParamsJson')
        }

        try {
            JSON.parse(button.buttonParamsJson)
        } catch {
            throw new Error(`Invalid buttonParamsJson for: ${button.name}`)
        }
    }
}

export function buildNativeFlowMessage(options: NativeFlowOptions) {
    if (!options.body?.trim()) {
        throw new Error('Native Flow body cannot be empty')
    }

    validateButtons(options.buttons)

    return proto.Message.InteractiveMessage.create({
        body: {
            text: options.body
        },
        ...(options.title ? {
            header: {
                title: options.title
            }
        } : {}),
        ...(options.footer ? {
            footer: {
                text: options.footer
            }
        } : {}),
        nativeFlowMessage: {
            buttons: options.buttons,
            messageVersion: options.messageVersion ?? 1
        }
    })
}

export function buildCarouselMessage(options: CarouselOptions) {
    if (!Array.isArray(options.cards) || options.cards.length === 0) {
        throw new Error('Carousel requires at least one card')
    }

    return proto.Message.InteractiveMessage.create({
        carouselMessage: {
            cards: options.cards,
            messageVersion: options.messageVersion ?? 1
        }
    })
}

export function buildInteractiveCard(options: {
    title?: string
    body: string
    footer?: string
    buttons: NativeFlowButton[]
}) {
    return buildNativeFlowMessage(options)
}

export type InteractiveListOptions = {
    title: string
    description?: string
    footerText?: string
    buttonText: string
    sections: proto.Message.ListMessage.ISection[]
}

export function buildListMessage(options: InteractiveListOptions) {
    if (!options.title?.trim()) {
        throw new Error('List title cannot be empty')
    }

    if (!options.buttonText?.trim()) {
        throw new Error('List buttonText cannot be empty')
    }

    if (!Array.isArray(options.sections) || options.sections.length === 0) {
        throw new Error('List requires at least one section')
    }

    for (const section of options.sections) {
        if (!section.rows?.length) {
            throw new Error('Every list section requires at least one row')
        }

        for (const row of section.rows) {
            if (!row.title?.trim() || !row.rowId?.trim()) {
                throw new Error('Every list row requires title and rowId')
            }
        }
    }

    return proto.Message.ListMessage.create({
        title: options.title,
        description: options.description,
        footerText: options.footerText,
        buttonText: options.buttonText,
        listType: proto.Message.ListMessage.ListType.SINGLE_SELECT,
        sections: options.sections
    })
}
