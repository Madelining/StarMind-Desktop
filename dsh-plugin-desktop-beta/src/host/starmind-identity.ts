/** Enforce the deployed product identity after upstream agent presets assemble their scoped personas. */
import {
  PERSONA_PREFIX_SECTION,
  PERSONA_SUFFIX_SECTION,
} from '@deepseek-ai/dsh-system-prompt'

interface StarMindPromptSection {
  name: string
  text: string
  interpolate?: boolean
}

interface StarMindPromptPresentation<Section extends StarMindPromptSection = StarMindPromptSection> {
  sections: Section[]
  contexts: unknown[]
  variables: Record<string, string | undefined>
}

export const STARMIND_AGENT_PERSONA = [
  'You are StarMind, an AI assistant that helps people focus and complete tasks.',
  'StarMind is your product name and your identity.',
  'When asked who you are, introduce yourself as StarMind. In Chinese, begin with "我是 StarMind".',
  'Do not describe yourself as an upstream framework, runtime, harness, or coding-agent instance.',
  'If the user explicitly asks about the underlying technology, discuss it as StarMind\'s implementation rather than as your identity.',
].join('\n')

export const STARMIND_AGENT_IDENTITY_RULES = [
  '## StarMind product identity',
  'Always present the product as StarMind. Do not use an upstream framework name as your own name or role.',
  'Keep the distinction clear: StarMind is the assistant and application; model providers and internal compatibility layers are implementation details.',
  'Do not volunteer internal paths, process names, environment variables, or runtime architecture when answering identity questions.',
].join('\n')

/**
 * Replace the final persona slots after every scoped preset has contributed.
 * The system-prompt waterfall is the only layer that can override an agent preset's
 * shadowing persona without forking every shipped preset.
 */
export function applyStarMindAgentIdentity<Section extends StarMindPromptSection, Presentation extends StarMindPromptPresentation<Section>>(
  assembly: Presentation,
): Presentation {
  let hasPrefix = false
  let hasSuffix = false
  const sections = assembly.sections.flatMap(section => {
    if (section.name === 'harness:identity') return []
    if (section.name === PERSONA_PREFIX_SECTION) {
      hasPrefix = true
      return [{ ...section, text: STARMIND_AGENT_PERSONA, interpolate: false }]
    }
    if (section.name === PERSONA_SUFFIX_SECTION) {
      hasSuffix = true
      return [{ ...section, text: STARMIND_AGENT_IDENTITY_RULES, interpolate: false }]
    }
    return [section]
  })
  if (!hasPrefix) sections.unshift({ name: PERSONA_PREFIX_SECTION, text: STARMIND_AGENT_PERSONA, interpolate: false } as Section)
  if (!hasSuffix) sections.push({ name: PERSONA_SUFFIX_SECTION, text: STARMIND_AGENT_IDENTITY_RULES, interpolate: false } as Section)
  return { ...assembly, sections } as Presentation
}
