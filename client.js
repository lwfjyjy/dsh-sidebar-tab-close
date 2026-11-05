// dsh-sidebar-tab-close —— 给右侧边栏的 tab 右键菜单追加「批量关闭」项（纯前端插件）
//
// 核心思路：
//   1) 官方槽位 sidebar.right.tab.menu.item 是「tab 菜单追加项」扩展位；注册一个组件，
//      右键任意 tab 的菜单里就会多出按钮。组件会拿到 { tab（被右键的 tab）, dismiss（收起菜单） }。
//   2) 点某项时：按「同一条 tab 栏」内从左到右的顺序，算出 左侧 / 右侧 / 其他 / 全部，
//      逐个调用 ctx.sidebarRight.close(id)；系统会自动跳过不可关闭的（如唯一 guide）。
//   3) 外观：注入一小段 CSS（dstc-item），照抄原生菜单项，避免依赖 dockkit 的哈希类名。
window.__ModuleLoader__.load({
  id: '@lwfjyjy/sidebar-tab-close',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'sidebarTabClose';

    // 中文兼作没有 locale 服务时的兜底
    const zh = {
      closeLeft: '关闭左侧',
      closeRight: '关闭右侧',
      closeOthers: '关闭其他',
      closeAll: '关闭全部',
    };
    const en = {
      closeLeft: 'Close Tabs to the Left',
      closeRight: 'Close Tabs to the Right',
      closeOthers: 'Close Other Tabs',
      closeAll: 'Close All Tabs',
    };

    // 样式只需注入一次，观感照抄 dockkit 原生菜单项
    function installStyle() {
      if (!document.head || document.getElementById('dstc-style')) return;
      const el = document.createElement('style');
      el.id = 'dstc-style';
      el.textContent = [
        '.dstc-item{padding:4px 7px;color:var(--dsw-alias-label-primary);font-size:calc(var(--dsh-content-font-size-secondary, 13px) - 1px);text-align:left;background:transparent;border:none;border-radius:var(--dsw-radius-md);cursor:pointer;white-space:nowrap}',
        '.dstc-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
        '.dstc-item:disabled{opacity:.45;cursor:default}',
        '.dstc-sep{height:1px;margin:4px 2px;background:var(--dsw-alias-border-l2)}',
      ].join('');
      document.head.appendChild(el);
    }

    // 找到被右键 tab 所在的那条 tab 栏，返回 { ids: 从左到右的顺序, hasClose: 上方是否已有原生「关闭」项 }
    // 找不到时返回 null，此时所有项置灰，避免误操作
    function readStrip(tabId) {
      const chip = Array.from(document.querySelectorAll('[data-dockkit-tab]')).find(
        (el) => el.getAttribute('data-dockkit-tab') === tabId && el.getClientRects().length > 0,
      );
      if (!chip) return null;
      const strip = chip.closest('[data-dockkit-strip-tabs]');
      const ids = strip
        ? Array.from(strip.querySelectorAll('[data-dockkit-tab]')).map((el) => el.getAttribute('data-dockkit-tab'))
        : [tabId];
      return { ids, hasClose: !!chip.querySelector('[data-dockkit-tab-close]') };
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'sidebar-tab-close: dictionaries');
      ctx.effect(() => installStyle(), 'sidebar-tab-close: style');
      const t = ctx.locale.bind(NS);

      // 菜单增强组件：关闭范围只限「当前这一栏」
      function TabMenuExtras(props) {
        const tabId = props && props.tab && props.tab.id;
        const dismiss = props && props.dismiss;

        // 只在 tab 变化时读一次 DOM 与会话快照，避免每次渲染都重复查询
        const info = React.useMemo(() => {
          const strip = tabId ? readStrip(tabId) : null;
          // 顺便记下「开始」页（kind === 'guide'）的 id，供「关闭全部」时保留
          const guideIds = new Set();
          try {
            const sessionId = ctx.sidebarRight.mounted.getSnapshot();
            const records = sessionId ? ctx.sidebarRight.tabsIn(sessionId) : [];
            for (const record of records) if (record.kind === 'guide') guideIds.add(record.id);
          } catch (e) { /* 拿不到会话快照就当作未知，全部按可关闭处理 */ }
          return { strip, guideIds };
        }, [tabId]);

        const strip = info.strip;
        const ids = strip ? strip.ids : [];
        const index = tabId ? ids.indexOf(tabId) : -1;
        const others = ids.filter((id) => id !== tabId);
        // 「关闭全部」跳过「开始」页，这样侧边栏不会收起，而是回到开始页
        const closableAll = ids.filter((id) => !info.guideIds.has(id));

        // 四类操作：文案 + 是否可用 + 要关闭的 tab 列表
        const actions = [
          { key: 'left', label: t('closeLeft'), disabled: index <= 0, targets: ids.slice(0, Math.max(index, 0)) },
          { key: 'right', label: t('closeRight'), disabled: index < 0 || index >= ids.length - 1, targets: ids.slice(index + 1) },
          { key: 'others', label: t('closeOthers'), disabled: others.length === 0, targets: others },
          { key: 'all', label: t('closeAll'), disabled: closableAll.length === 0, targets: closableAll, keepHome: true },
        ];

        // 先收起菜单再关闭：避免关掉自身所在 tab 后组件已卸载仍去更新状态
        const run = (action) => {
          if (dismiss) dismiss();
          for (const id of action.targets) {
            try { ctx.sidebarRight.close(id); } catch (e) { /* 跳过不可关闭的 tab */ }
          }
          // 「关闭全部」后再确保「开始」页存在（原本没有时补一个），侧边栏保持打开
          if (action.keepHome) {
            try { ctx.sidebarRight.openTab('guide'); } catch (e) { /* 没有 guide 类型时忽略 */ }
          }
        };

        const children = [];
        if (strip && strip.hasClose) children.push(h('div', { key: 'sep', className: 'dstc-sep' }));
        for (const action of actions) {
          children.push(h('button', {
            key: action.key,
            type: 'button',
            role: 'menuitem',
            className: 'dstc-item',
            disabled: action.disabled,
            onClick: () => run(action),
          }, action.label));
        }
        return h(React.Fragment, null, children);
      }

      // 注册到「tab 菜单追加项」槽位
      ctx.slots.inject('sidebar.right.tab.menu.item', () =>
        ctx.slots.register(
          { name: 'sidebar.right.tab.menu.item', id: 'sidebar-tab-close', order: 50 },
          TabMenuExtras,
        ),
      );
    }

    return { inject: ['slots', 'locale', 'sidebarRight'], apply };
  },
});
