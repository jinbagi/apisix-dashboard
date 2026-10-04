/**
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import type { Locator } from '@playwright/test';

export async function textContrast(locator: Locator, placeholder = false) {
  return locator.evaluate((element, placeholder) => {
    const rgba = (value: string): number[] => {
      const numbers = value.match(/[\d.]+/g)?.map(Number);
      if (!numbers || numbers.length < 3) throw new Error(`Unsupported color: ${value}`);
      const scale = value.startsWith('color(srgb ') ? 255 : 1;
      return [numbers[0] * scale, numbers[1] * scale, numbers[2] * scale, numbers[3] ?? 1];
    };
    const composite = (front: number[], back: number[]) => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      return [0, 1, 2].map(i => (front[i] * front[3] + back[i] * back[3] * (1 - front[3])) / alpha).concat(alpha);
    };
    const luminance = (color: number[]) => color.slice(0, 3).map(value => value / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const layers: number[][] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== 'none' || style.opacity !== '1') throw new Error('This assertion needs a solid, unmasked text surface.');
      layers.unshift(rgba(style.backgroundColor));
    }
    const background = layers.reduce((back, front) => composite(front, back), [255, 255, 255, 1]);
    const color = getComputedStyle(element, placeholder ? '::placeholder' : null).color;
    const foreground = composite(rgba(color), background);
    const [bright, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return { text: element.textContent, color, background, fontSize: getComputedStyle(element).fontSize, fontWeight: getComputedStyle(element).fontWeight, focusVisible: element.matches(':focus-visible'), ratio: (bright + 0.05) / (dark + 0.05) };
  }, placeholder);
}

