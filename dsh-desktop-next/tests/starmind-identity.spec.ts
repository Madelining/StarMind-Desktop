import { PERSONA_PREFIX_SECTION, PERSONA_SUFFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it } from 'vitest'
import {
  applyStarMindAgentIdentity,
  STARMIND_AGENT_IDENTITY_RULES,
  STARMIND_AGENT_PERSONA,
} from '../src/host/starmind-identity.ts'

describe('StarMind agent identity', () => {
  it('overrides a scoped preset persona and keeps the upstream harness opener out', () => {
    const assembly = {
      contexts: [],
      variables: { model: 'deepseek-flash' },
      sections: [
        { name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.' },
        { name: PERSONA_PREFIX_SECTION, text: 'You are a coding agent powered by the {{model}} model.' },
        { name: 'tools:bash', text: 'Use the shell.' },
        { name: PERSONA_SUFFIX_SECTION, text: 'Runtime: DSH' },
      ],
    }

    const identity = applyStarMindAgentIdentity(assembly)

    expect(identity.sections.map(section => section.name)).toEqual([
      PERSONA_PREFIX_SECTION,
      'tools:bash',
      PERSONA_SUFFIX_SECTION,
    ])
    expect(identity.sections[0]).toMatchObject({ text: STARMIND_AGENT_PERSONA, interpolate: false })
    expect(identity.sections[2]).toMatchObject({ text: STARMIND_AGENT_IDENTITY_RULES, interpolate: false })
    expect(identity.sections.some(section => section.text.includes('coding agent powered'))).toBe(false)
    expect(identity.sections.some(section => section.name === 'harness:identity')).toBe(false)
  })

  it('adds both identity slots when a complete or malformed preset omits them', () => {
    const identity = applyStarMindAgentIdentity({
      contexts: [],
      variables: {},
      sections: [{ name: 'preset:custom', text: 'A custom prompt.', complete: true } as never],
    })

    expect(identity.sections[0]).toMatchObject({ name: PERSONA_PREFIX_SECTION, text: STARMIND_AGENT_PERSONA })
    expect(identity.sections.at(-1)).toMatchObject({ name: PERSONA_SUFFIX_SECTION, text: STARMIND_AGENT_IDENTITY_RULES })
  })
})
