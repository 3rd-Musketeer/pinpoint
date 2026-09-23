import { Fragment } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { PAGE_SORT_GROUPS, PAGE_SORT_LABELS } from '../lib/page-sort.js';
import { Button } from './ui/button.jsx';
import { WbIcon } from './WbIcon.jsx';
import { ROW_MENU_ITEM, ROW_MENU_PANEL } from './row-menu.jsx';

export function PageSortMenu({ sort, onChange }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button type="button" variant="tool" size="icon"
          className="wb-page-sort size-[18px] [&_svg]:opacity-60 hover:[&_svg]:opacity-100"
          data-page-sort={sort}
          aria-label={'Pages 排序：' + PAGE_SORT_LABELS[sort]}
          title={'排序：' + PAGE_SORT_LABELS[sort]}>
          <WbIcon name="sort" size={11} className="size-[11px]" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={ROW_MENU_PANEL + ' wb-sort-menu w-[250px] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto'}
          align="end" sideOffset={5} collisionPadding={8}>
          <DropdownMenu.RadioGroup value={sort} onValueChange={onChange}>
            {PAGE_SORT_GROUPS.map((group, index) => (
              <Fragment key={group[0]}>
                {index > 0 && <DropdownMenu.Separator className="my-1 h-px bg-border" />}
                {group.map(value => (
                  <DropdownMenu.RadioItem key={value} value={value} className={ROW_MENU_ITEM}>
                    <span className="w-[15px] shrink-0" aria-hidden="true">
                      <DropdownMenu.ItemIndicator>✓</DropdownMenu.ItemIndicator>
                    </span>
                    <span>{PAGE_SORT_LABELS[value]}</span>
                  </DropdownMenu.RadioItem>
                ))}
              </Fragment>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
