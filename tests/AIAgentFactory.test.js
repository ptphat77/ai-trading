const AIAgentFactory = require('../src/ai/AIAgentFactory');
const QwenAgent = require('../src/ai/QwenAgent');
const GeminiAgent = require('../src/ai/GeminiAgent');

describe('AIAgentFactory', () => {
  it('should instantiate QwenAgent by default or when provider is qwen', () => {
    const agent = AIAgentFactory.createAgent({ provider: 'qwen' });
    expect(agent).toBeInstanceOf(QwenAgent);
  });

  it('should instantiate GeminiAgent when provider is gemini', () => {
    const agent = AIAgentFactory.createAgent({ provider: 'gemini' });
    expect(agent).toBeInstanceOf(GeminiAgent);
  });
});
