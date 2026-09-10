function letter_box(sq_size, pos_x, pos_y){
    this.square = new Kinetic.Rect({ x: pos_x, y: pos_y, width: sq_size, height: sq_size, fill: "#428bca", stroke: 'white' });
    this.symbol = new Kinetic.Text({ x: pos_x, y: pos_y + sq_size/6, fill: "white", text: "", fontSize: 2 * sq_size/3, fontFamily: 'Helvetica', height: sq_size, width: sq_size, align: 'center' });
}

function cinta(pos_y, n_cells, sq_size) {
    this.n_cells = n_cells;
    this.sq_size = sq_size;
    this.square_group = new Kinetic.Group({});
    this.symbol_group = new Kinetic.Group({});

    for(var i = 0; i < n_cells; i++){
        var l_box = new letter_box(sq_size, sq_size * (i-1), pos_y);
        this.symbol_group.add(l_box.symbol);
        this.square_group.add(l_box.square);
    }

    this.get_square_group = function() { return this.square_group; }
    this.get_symbol_group = function() { return this.symbol_group; }

    this.sync = function(tapeData, blankChar) {
        var middle = Math.floor(this.n_cells / 2);
        
        for (var b = 0; b < this.n_cells; b++) {
            var string_idx = tapeData.head_position + (b - middle);
            var char = blankChar;
            
            if (string_idx >= 0 && string_idx < tapeData.string.length) {
                char = tapeData.string.charAt(string_idx);
            }
            
            this.symbol_group.getChildren()[b].setText(char);
        }
    }
}

let pyodide, session;
let myCodeMirror, stage, layer;
let tapes = [];
let current_tape_data = []; 
let n_tapes = 1;
let total_width, sq_size, ncells;
let step_counter = 0;
let playInterval;
let pause = true;
let trans_speed = 1000;
let input_loaded = false;
let currentHighlight = null;

$(document).ready(function() {
    myCodeMirror = CodeMirror.fromTextArea(document.getElementById('code_editor'), {
        mode: "text/html", lineNumbers: true
    });
    
    myCodeMirror.setValue("// Start writing Varphi code here...\ns0 ($x) s0 ($x) (RIGHT)\ns0 (BLANK) s1 (BLANK) (STAY)");

    total_width = document.body.offsetWidth > 1080 ? document.getElementById('editor_container').offsetWidth : document.body.offsetWidth * 0.9;
    ncells = document.body.offsetWidth > 720 ? 25 : 17;

    stage = new Kinetic.Stage({ container: "container", width: total_width, height: 0 });
    layer = new Kinetic.Layer();
    stage.add(layer);

    let speed_bar = document.getElementById('speed_bar');
    noUiSlider.create(speed_bar, {
        start: [50], step: 1, range: { 'min': 0, 'max': 100 }, connect: "lower",
    });
    speed_bar.noUiSlider.on('slide', function() {
        let val = parseInt(speed_bar.noUiSlider.get());
        trans_speed = val === 100 ? 0 : (100 - val) * 15; 
    });

    $('.message .close').on('click', function() { $(this).closest('.message').slideUp(250); });

    const urlParams = new URLSearchParams(window.location.search);
    const exampleParam = urlParams.get('example');

    $('.ui.dropdown').dropdown({
        onChange: function(value) {
            if (!value) return;
            
            const queryValue = value.replace('.vp', '');
            const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?example=' + queryValue;
            window.history.pushState({path:newUrl}, '', newUrl);

            const url = `https://raw.githubusercontent.com/varphi-lang/examples/refs/heads/main/${value}`;
            const $loader = $('#loader');
            $loader.addClass('disabled').html('<i class="circle notch loading icon"></i> Fetching Example...');
            
            $.get(url).done(function(data) {
                myCodeMirror.setValue(data);
                if (session) {
                    $loader.removeClass('disabled').html('Compile Varphi');
                    $loader.click(); 
                } else {
                    $loader.html('<i class="circle notch loading icon"></i> Initializing Varphi Compiler...');
                }
            }).fail(function() {
                showError("Failed to fetch example from GitHub.");
                if (session) $loader.removeClass('disabled').html('Compile Varphi');
            });
        }
    });

    if (exampleParam) {
        const exampleFile = exampleParam.endsWith('.vp') ? exampleParam : exampleParam + '.vp';
        setTimeout(() => {
            $('.ui.dropdown').dropdown('set selected', exampleFile);
        }, 100);
    }
    
    initPyodideEnv();
});

async function initPyodideEnv() {
    try {
        pyodide = await loadPyodide();
        await pyodide.loadPackage("micropip");
        const micropip = pyodide.pyimport("micropip");
        
        await micropip.install(["vp2web"]);
        
        pyodide.runPython("from vp2web import session");
        session = pyodide.globals.get("session");
        
        $('#loader').removeClass('disabled').html('Compile Varphi');

        const code = myCodeMirror.getValue();
        if (code !== "// Start writing Varphi code here...\ns0 ($x) s0 ($x) (RIGHT)\ns0 (BLANK) s1 (BLANK) (STAY)") {
            $('#loader').click();
        }

    } catch (err) {
        $('#loader').addClass('red disabled').text('Failed to load Pyodide');
        showError("Failed to initialize python environment: " + err);
    }
}

$('#loader').click(function() {
    $('#log_container').slideUp();
    const code = myCodeMirror.getValue();
    const result = JSON.parse(session.compile(code));

    if (result.success) {
        n_tapes = result.k;
        let inputsHtml = "";
        for (let i = 0; i < n_tapes; i++) {
            inputsHtml += `<div class="ui fluid input" style="margin-bottom: 5px;">
                <input type="text" id="tape_input_${i}" placeholder="Tape ${i+1} Initial Value (Leave empty for BLANK)" aria-label="Tape ${i+1} Input">
            </div>`;
        }
        $('#dynamic_tapes_container').html(inputsHtml);
        
        $('#machine').slideDown();
        loadStage();
    } else {
        showError("<strong>Compilation Error</strong>: " + result.error);
    }
});

$('#load_input').click(function() {
    const blankChar = $('#blank_char_input').val() || " ";
    let inputs = [];
    for (let i = 0; i < n_tapes; i++) {
        inputs.push($(`#tape_input_${i}`).val() || "");
    }
    
    const pyInputs = pyodide.toPy(inputs);
    const result = JSON.parse(session.init_machine(pyInputs, blankChar));
    pyInputs.destroy();

    if (result.error) {
        showError(result.error);
        return;
    }

    input_loaded = true;
    step_counter = 0;
    $('#counter_text').text("Steps: 0");
    $('#halted_text').hide();
    
    enableButtons();
    updateUI(result, blankChar);
});

$('#play').click(function() {
    if (!input_loaded || !pause) return;
    pause = false;
    $('#play').addClass('disabled');
    $('#pause').removeClass('disabled');
    
    function loop() {
        if (pause) return;
        stepMachine();
        setTimeout(loop, trans_speed);
    }
    setTimeout(loop, 0);
});

$('#pause').click(function() {
    pause = true;
    $('#play').removeClass('disabled');
    $('#pause').addClass('disabled');
});

$('#step').click(function() {
    if (!input_loaded) return;
    pause = true;
    $('#play').removeClass('disabled');
    $('#pause').addClass('disabled');
    stepMachine();
});

function stepMachine() {
    const result = JSON.parse(session.step());
    step_counter++;
    $('#counter_text').text("Steps: " + step_counter);
    updateUI(result, $('#blank_char_input').val() || " ");
}

function updateUI(data, blankChar) {
    current_tape_data = data.tapes; 

    $('#state_text').text("State: " + data.state);
    
    for (let i = 0; i < n_tapes; i++) {
        tapes[i].sync(data.tapes[i], blankChar);
    }
    layer.draw();
    
    if (currentHighlight !== null) {
        try {
            myCodeMirror.removeLineClass(currentHighlight, 'background', 'cm-highlight-line');
        } catch (e) {}
        currentHighlight = null;
    }
    
    if (data.line_number !== null && data.line_number !== undefined) {
        let lineIdx = data.line_number - 1; 
        
        if (lineIdx >= 0 && lineIdx < myCodeMirror.lineCount()) {
            currentHighlight = myCodeMirror.addLineClass(lineIdx, 'background', 'cm-highlight-line');
            
            let localCoords = myCodeMirror.charCoords({line: lineIdx, ch: 0}, "local");
            let halfEditorHeight = myCodeMirror.getScrollerElement().offsetHeight / 2;
            myCodeMirror.scrollTo(null, localCoords.top - halfEditorHeight);
        }
    }

    if (data.halted) {
        pause = true;
        disableButtons();
        $('#halted_text').text("Halted at " + data.state).show();
    }
}

function loadStage() {
    stage.clear();
    layer.destroyChildren();
    
    $('#container').find('.tape-copy-btn').remove(); 
    
    sq_size = total_width / (ncells - 2);
    let total_height = Math.floor(1.6 * sq_size * n_tapes + sq_size / 2);
    stage.setHeight(total_height);
    
    tapes = [];
    let pos_x = total_width / 2;

    for(let j = 0; j < n_tapes; j++) {
        tapes[j] = new cinta((1.6 * j + 0.33) * sq_size, ncells, sq_size);
        let pos_y = (1.6 * j + 1.33) * sq_size - sq_size/6;
        
        let poly = new Kinetic.RegularPolygon({
          x: pos_x, y: pos_y + 2*sq_size/5, sides: 3, radius: sq_size/3, fill: "#000", stroke: "#fff", strokeWidth: 2
        });
        
        layer.add(tapes[j].get_square_group());
        layer.add(poly); 
        layer.add(tapes[j].get_symbol_group());

        let btn = $(`<button class="ui mini icon button tape-copy-btn" style="position: absolute; right: 10px; z-index: 10;" title="Copy Tape ${j+1} Contents" aria-label="Copy Tape ${j+1}"><i class="copy icon"></i></button>`);
        btn.css('top', ((1.6 * j + 0.33) * sq_size) + (sq_size - 28)/2 + 'px'); 
        btn.click(function() { window.copyTape(j, this); });
        $('#container').append(btn);
    }
    stage.add(layer);
    layer.draw();
}

window.copyTape = function(index, btnElement) {
    if (current_tape_data && current_tape_data[index]) {
        const text = current_tape_data[index].string;
        navigator.clipboard.writeText(text).then(() => {
            let icon = $(btnElement).find('i');
            icon.removeClass('copy').addClass('check green');
            setTimeout(() => { icon.removeClass('check green').addClass('copy'); }, 1500);
        }).catch(err => {
            console.error('Failed to copy: ', err);
        });
    }
};

function enableButtons() {
    $("#play, #step").removeClass('disabled');
    $("#pause").addClass('disabled');
}
function disableButtons() {
    $("#play, #pause, #step").addClass('disabled');
}
function showError(msg) {
    $("#log").html(msg);
    $("#log_container").slideDown();
}