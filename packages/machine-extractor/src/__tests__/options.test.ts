import { types as t } from '@babel/core';
import { parseMachinesFromFile } from '..';

describe('Options', () => {
  it('Should handle functions declared as ObjectMethod', () => {
    const result = parseMachinesFromFile(`
      const machine = createMachine({}, {
        services: {
          service() {}
        }
      })
    `);

    expect(result.machines[0].ast.options?.services?.properties).toHaveLength(
      1,
    );

    const node =
      result.machines[0].ast.options?.services?.properties[0].property;

    expect(t.isObjectMethod(node)).toBeTruthy();
  });
});
