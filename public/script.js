async function generateMindmap() {
    const text = document.getElementById("inputText").value;

    const res = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, task: "mindmap" })
    });

    const data = await res.json();
    drawMindmap(data.mindmap);
}

function drawMindmap(treeData) {
    document.getElementById("mindmap").innerHTML = ""; // clear old

    const width = document.getElementById("mindmap").clientWidth;
    const height = 700;

    const svg = d3.select("#mindmap")
        .append("svg")
        .attr("width", width)
        .attr("height", height);

    const g = svg.append("g").attr("transform", "translate(50,50)");

    const root = d3.hierarchy(treeData);
    const treeLayout = d3.tree().size([height - 100, width - 200]);
    treeLayout(root);

    // Draw links
    g.selectAll(".link")
        .data(root.links())
        .enter().append("line")
        .attr("class", "link")
        .attr("x1", d => d.source.y)
        .attr("y1", d => d.source.x)
        .attr("x2", d => d.target.y)
        .attr("y2", d => d.target.x)
        .attr("stroke", "#999")
        .attr("stroke-width", 2);

    // Draw nodes
    const node = g.selectAll(".node")
        .data(root.descendants())
        .enter().append("g")
        .attr("class", "node")
        .attr("transform", d => `translate(${d.y},${d.x})`);

    node.append("circle")
        .attr("r", 20)
        .attr("fill", "#fff")
        .attr("stroke", "#2563eb")
        .attr("stroke-width", 3);

    node.append("text")
        .attr("dy", ".35em")
        .attr("x", 0)
        .attr("text-anchor", "middle")
        .text(d => d.data.name)
        .style("font-size", "14px");
}
