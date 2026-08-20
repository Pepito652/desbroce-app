/**
 * components/form-controls.js
 * Generador de controles de formulario con id, name, accesibilidad y estilos acordes
 */

function createSelectElement({ id, name, className = '', style = '', options = [], selectedValue = '', onChange = null, title = '' }) {
    const select = document.createElement('select');
    if (id) select.id = id;
    if (name) select.name = name;
    if (className) select.className = className;
    if (title) select.title = title;
    if (style) select.style.cssText = style;

    options.forEach(opt => {
        const optionEl = document.createElement('option');
        optionEl.value = opt.value !== undefined ? opt.value : opt;
        optionEl.innerText = opt.label !== undefined ? opt.label : opt;
        if (optionEl.value === String(selectedValue)) {
            optionEl.selected = true;
        }
        select.appendChild(optionEl);
    });

    if (typeof onChange === 'function') {
        select.addEventListener('change', onChange);
    }

    return select;
}

function createSelectHtml({ id, name, className = '', style = '', options = [], selectedValue = '', onchangeAttr = '', title = '' }) {
    const idAttr = id ? `id="${id}"` : '';
    const nameAttr = name ? `name="${name}"` : '';
    const classAttr = className ? `class="${className}"` : '';
    const styleAttr = style ? `style="${style}"` : '';
    const onChangeStr = onchangeAttr ? `onchange="${onchangeAttr}"` : '';
    const titleAttr = title ? `title="${title}"` : '';

    let optionsHtml = '';
    options.forEach(opt => {
        const val = opt.value !== undefined ? opt.value : opt;
        const lbl = opt.label !== undefined ? opt.label : opt;
        const sel = String(val) === String(selectedValue) ? 'selected' : '';
        optionsHtml += `<option value="${val}" ${sel}>${lbl}</option>`;
    });

    return `<select ${idAttr} ${nameAttr} ${classAttr} ${styleAttr} ${onChangeStr} ${titleAttr}>${optionsHtml}</select>`;
}

if (typeof window !== 'undefined') {
    window.createSelectElement = createSelectElement;
    window.createSelectHtml = createSelectHtml;
    window.DesbroceForms = {
        createSelectElement,
        createSelectHtml
    };
}
